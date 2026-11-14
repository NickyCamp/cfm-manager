-- Weekly payout reports instead of automatic Ticket transfers (Nick, 2026-11-14),
-- plus the fixes from the Markets review (Fable, 2026-11-14).
--
-- The site no longer takes or pays Tickets through UnbelievaBoat. A bet only
-- records a stake; results go in market_ledger, and after each advance the bot posts
-- a "Previous Week Payouts" channel with every member's net gain/loss for admins to
-- add/remove by hand and mark Applied. The site's balance shows
--   UnbelievaBoat balance - open stakes + results not applied yet,
-- so it's right straight away even though UnbelievaBoat only changes when admins apply.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------- ledger
create table if not exists public.market_ledger (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  book int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('result', 'cancel', 'void', 'credit')),
  market_key text,
  outcome_id text,
  side text,
  qty numeric(14,4),
  cost numeric(14,2),
  payout numeric(14,2),
  amount numeric(14,2) not null,          -- Tickets to add (+) or remove (-) in UnbelievaBoat
  note text not null default '',
  trade_id bigint,                        -- void rows: the trade that was voided
  created_at timestamptz not null default now(),
  report_key text,                        -- the payout report it was last shown in
  applied_at timestamptz,                 -- an admin applied it in UnbelievaBoat
  applied_by text
);
create index if not exists market_ledger_open_idx on public.market_ledger (league_id, user_id) where applied_at is null;
create index if not exists market_ledger_league_idx on public.market_ledger (league_id, id desc);
alter table public.market_ledger enable row level security;

-- Who, what and how much never change and rows are never deleted; only the report/applied fields move.
create or replace function public.market_ledger_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.leagues where id = old.league_id) then raise exception 'market_ledger is append-only'; end if;
    return old;
  end if;
  if new.league_id <> old.league_id or new.book <> old.book or new.user_id <> old.user_id or new.kind <> old.kind
     or new.amount <> old.amount or new.note <> old.note or new.created_at <> old.created_at
     or new.market_key is distinct from old.market_key or new.outcome_id is distinct from old.outcome_id
     or new.trade_id is distinct from old.trade_id then
    raise exception 'only the report and applied fields of a ledger row can change';
  end if;
  return new;
end $$;
drop trigger if exists market_ledger_guard on public.market_ledger;
create trigger market_ledger_guard before update or delete on public.market_ledger
  for each row execute function public.market_ledger_guard();

-- ---------------------------------------------------------------- voided trades
-- Bets placed after a game's real kickoff (checked by an admin) are voided: the trade
-- stays in the public log, marked void, and its effect is reversed in the ledger.
create table if not exists public.market_trade_voids (
  trade_id bigint primary key references public.market_trades (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  delta numeric(14,2) not null,
  reason text not null,
  voided_by text not null,
  created_at timestamptz not null default now()
);
alter table public.market_trade_voids enable row level security;
drop trigger if exists market_trade_voids_no_edits on public.market_trade_voids;
create trigger market_trade_voids_no_edits before update or delete on public.market_trade_voids
  for each row execute function public.market_trades_append_only();

-- Kickoff rows can now also be an admin's verified kickoff.
alter table public.market_game_close drop constraint if exists market_game_close_set_by_kind_check;
alter table public.market_game_close add constraint market_game_close_set_by_kind_check check (set_by_kind in ('site', 'discord', 'verified'));

-- ---------------------------------------------------------------- trades (both currencies)
-- One buy or cancel. Locks the whole market (linked prices depend on every outcome's net)
-- and then the member, checks every net in the market against what the price was worked
-- out from, and refuses bets that would hedge an open position (p_conflicts).
--   Buy:    p_amount = stake. Tickets: must fit in p_balance - open stakes + unapplied results.
--   Cancel: p_amount = what the contracts are worth at the market now. The refund is the
--           smaller of that and what they cost (pro rata), so cancelling can never make money.
-- Returns {"r": ok|stale|qty|cash|conflict|bad, "amount": refund or available balance}.
create or replace function public.market_trade2(
  p_league uuid, p_book int, p_user uuid, p_market text, p_outcome text, p_side text, p_kind text,
  p_qty numeric, p_amount numeric, p_expected jsonb, p_new_net numeric,
  p_price_before numeric, p_price_after numeric, p_tickets boolean, p_balance numeric, p_conflicts jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pos public.market_positions%rowtype; v_cash numeric; v_avail numeric; v_part numeric; v_refund numeric; v_amount numeric;
begin
  if p_side not in ('yes', 'no') or p_kind not in ('buy', 'sell') or p_qty <= 0 or p_amount < 0 then return jsonb_build_object('r', 'bad'); end if;
  perform pg_advisory_xact_lock(hashtextextended('mkt:' || p_league || ':' || p_book || ':' || p_market, 0));
  perform pg_advisory_xact_lock(hashtextextended('usr:' || p_league || ':' || p_user, 0));

  if exists (
    select 1 from (select outcome_id, net from market_pools where league_id = p_league and season = p_book and market_key = p_market) p
    full join jsonb_each_text(coalesce(p_expected, '{}'::jsonb)) e on e.key = p.outcome_id
    where abs(coalesce(p.net, 0) - coalesce(e.value::numeric, 0)) > 0.0001
  ) then return jsonb_build_object('r', 'stale'); end if;

  insert into market_pools (league_id, season, market_key, outcome_id) values (p_league, p_book, p_market, p_outcome) on conflict do nothing;
  select * into v_pos from market_positions where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side for update;

  if p_kind = 'buy' then
    if p_conflicts is not null and exists (
      select 1 from market_positions mp, jsonb_array_elements(p_conflicts) c
      where mp.league_id = p_league and mp.season = p_book and mp.user_id = p_user and mp.market_key = p_market
        and mp.outcome_id = c->>0 and mp.side = c->>1
    ) then return jsonb_build_object('r', 'conflict'); end if;
    v_amount := p_amount;
    if p_tickets then
      v_avail := p_balance
        - coalesce((select sum(cost) from market_positions where league_id = p_league and user_id = p_user and season % 10 = 1), 0)
        + coalesce((select sum(amount) from market_ledger where league_id = p_league and user_id = p_user and applied_at is null), 0);
      if v_avail < p_amount then return jsonb_build_object('r', 'cash', 'amount', floor(v_avail)); end if;
    else
      insert into market_wallets (league_id, season, user_id) values (p_league, p_book, p_user) on conflict do nothing;
      select cash into v_cash from market_wallets where league_id = p_league and season = p_book and user_id = p_user for update;
      if v_cash < p_amount then return jsonb_build_object('r', 'cash', 'amount', v_cash); end if;
      update market_wallets set cash = cash - p_amount where league_id = p_league and season = p_book and user_id = p_user;
    end if;
    insert into market_positions (league_id, season, user_id, market_key, outcome_id, side, qty, cost)
      values (p_league, p_book, p_user, p_market, p_outcome, p_side, p_qty, p_amount)
      on conflict (league_id, season, user_id, market_key, outcome_id, side)
      do update set qty = market_positions.qty + excluded.qty, cost = market_positions.cost + excluded.cost;
  else
    if v_pos.qty is null or v_pos.qty < p_qty - 0.0001 then return jsonb_build_object('r', 'qty'); end if;
    v_part := case when p_qty >= v_pos.qty - 0.0001 then v_pos.cost else round(v_pos.cost * p_qty / v_pos.qty, 2) end;
    v_refund := least(v_part, round(p_amount, 2));
    v_amount := v_refund;
    if v_pos.qty - p_qty < 0.0001 then
      delete from market_positions where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    else
      update market_positions set qty = qty - p_qty, cost = cost - v_part
        where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    end if;
    if p_tickets then
      if v_refund < v_part then
        insert into market_ledger (league_id, book, user_id, kind, market_key, outcome_id, side, qty, cost, payout, amount, note)
          values (p_league, p_book, p_user, 'cancel', p_market, p_outcome, p_side, p_qty, v_part, v_refund, v_refund - v_part, 'Cancelled after the price moved against it');
      end if;
    else
      update market_wallets set cash = cash + v_refund where league_id = p_league and season = p_book and user_id = p_user;
    end if;
  end if;

  update market_pools set net = p_new_net, volume = volume + v_amount, updated_at = now()
    where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome;
  insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount, price_before, price_after)
    values (p_league, p_book, p_user, p_market, p_outcome, p_side, p_kind, p_qty, v_amount, p_price_before, p_price_after);
  return jsonb_build_object('r', 'ok', 'amount', v_amount);
end;
$$;

-- Settles one outcome: p_winner 'yes' / 'no', or 'void' (e.g. a tied game: every stake back).
-- Tickets: each position becomes a ledger row (payout - stake) for the weekly report.
create or replace function public.market_settle2(p_league uuid, p_book int, p_market text, p_outcome text, p_winner text, p_per_contract numeric, p_tickets boolean, p_note text)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pay numeric;
begin
  if p_winner not in ('yes', 'no', 'void') then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('mkt:' || p_league || ':' || p_book || ':' || p_market, 0));
  for r in select * from market_positions where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome for update loop
    pay := case when p_winner = 'void' then r.cost when r.side = p_winner then r.qty * p_per_contract else 0 end;
    insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount)
      values (p_league, p_book, r.user_id, p_market, p_outcome, r.side, 'settle', r.qty, pay);
    if p_tickets then
      insert into market_ledger (league_id, book, user_id, kind, market_key, outcome_id, side, qty, cost, payout, amount, note)
        values (p_league, p_book, r.user_id, 'result', p_market, p_outcome, r.side, r.qty, r.cost, pay, pay - r.cost,
                case when p_winner = 'void' then 'Void: stake back (' || p_note || ')' when r.side = p_winner then 'Won (' || p_note || ')' else 'Lost (' || p_note || ')' end);
    else
      insert into market_wallets (league_id, season, user_id) values (p_league, p_book, r.user_id) on conflict do nothing;
      update market_wallets set cash = cash + pay where league_id = p_league and season = p_book and user_id = r.user_id;
    end if;
    n := n + 1;
  end loop;
  delete from market_positions where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome;
  return n;
end;
$$;

-- Voids one trade after its market settled (placed after the real kickoff). p_result is how
-- that trade's side finished: 'won', 'lost' or 'void'. The reversal goes in the ledger
-- (Tickets) or straight into the play-money wallet. Returns 'ok', 'done' (already void) or 'bad'.
create or replace function public.market_void_trade(p_trade bigint, p_result text, p_per_contract numeric, p_tickets boolean, p_by text, p_reason text)
returns text
language plpgsql security definer set search_path = public as $$
declare t public.market_trades%rowtype; pay numeric; delta numeric;
begin
  select * into t from market_trades where id = p_trade;
  if t.id is null or t.kind not in ('buy', 'sell') or p_result not in ('won', 'lost', 'void') then return 'bad'; end if;
  perform pg_advisory_xact_lock(hashtextextended('usr:' || t.league_id || ':' || t.user_id, 0));
  if exists (select 1 from market_trade_voids where trade_id = p_trade) then return 'done'; end if;
  pay := case p_result when 'won' then t.qty * p_per_contract when 'lost' then 0 else t.amount end;
  delta := case when t.kind = 'buy' then t.amount - pay else pay - t.amount end;
  insert into market_trade_voids (trade_id, league_id, delta, reason, voided_by) values (p_trade, t.league_id, delta, p_reason, p_by);
  if p_tickets then
    insert into market_ledger (league_id, book, user_id, kind, market_key, outcome_id, side, qty, cost, payout, amount, note, trade_id)
      values (t.league_id, t.season, t.user_id, 'void', t.market_key, t.outcome_id, t.side, t.qty, t.amount, pay, delta, p_reason, p_trade);
  else
    update market_wallets set cash = cash + delta where league_id = t.league_id and season = t.season and user_id = t.user_id;
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb) from public, anon, authenticated;
revoke execute on function public.market_settle2(uuid, int, text, text, text, numeric, boolean, text) from public, anon, authenticated;
revoke execute on function public.market_void_trade(bigint, text, numeric, boolean, text, text) from public, anon, authenticated;
grant execute on function public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb) to service_role;
grant execute on function public.market_settle2(uuid, int, text, text, text, numeric, boolean, text) to service_role;
grant execute on function public.market_void_trade(bigint, text, numeric, boolean, text, text) to service_role;
grant select, insert, update on public.market_ledger to service_role;
grant select, insert on public.market_trade_voids to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- moving over from automatic transfers
-- 1) Ticket payments the old system still owed (or wasn't sure it sent) become report lines.
insert into public.market_ledger (league_id, book, user_id, kind, amount, note)
select league_id, book, user_id, 'credit', amount,
       case when status = 'sending' then 'Owed by the old auto-payout (it may have gone through: check UnbelievaBoat first): ' else 'Owed by the old auto-payout: ' end || replace(reason, 'CFM Markets: ', '')
from public.market_ticket_moves
where status in ('pending', 'sending', 'failed') and amount > 0
  and not exists (select 1 from public.market_ledger l where l.kind = 'credit' and l.note like '%' || replace(market_ticket_moves.reason, 'CFM Markets: ', '') and l.user_id = market_ticket_moves.user_id);
update public.market_ticket_moves set status = 'failed', error = 'Moved to the weekly payouts report'
where status in ('pending', 'sending');

-- 2) Open Tickets bets: the old system already took their stake from UnbelievaBoat. Give it back
--    in the first report; the bet stays open and settles like any other.
insert into public.market_ledger (league_id, book, user_id, kind, market_key, outcome_id, side, qty, cost, amount, note)
select p.league_id, p.season, p.user_id, 'credit', p.market_key, p.outcome_id, p.side, p.qty, p.cost, round(p.cost),
       'Stake the old system took from UnbelievaBoat when the bet was placed (the bet is still open)'
from public.market_positions p
where p.season % 10 = 1
  and not exists (select 1 from public.market_ledger l where l.kind = 'credit' and l.user_id = p.user_id and l.market_key = p.market_key and l.outcome_id = p.outcome_id and l.side = p.side);

-- 3) Discord links move out of user_metadata (which a member can edit themselves) into
--    app_metadata (only the server can write it).
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('discord_id', raw_user_meta_data->>'discord_id', 'discord_name', coalesce(raw_user_meta_data->>'discord_name', '')),
    raw_user_meta_data = raw_user_meta_data - 'discord_id' - 'discord_name'
where raw_user_meta_data ? 'discord_id';

notify pgrst, 'reload schema';
