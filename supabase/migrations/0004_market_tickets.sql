-- Markets in real league Tickets, through UnbelievaBoat (Nick, 2026-11-13).
-- UnbelievaBoat stays the only bank: buying takes Tickets from the member's
-- UnbelievaBoat balance, selling and winnings pay them back. This table is the
-- record of every Ticket movement the site makes (public in the trade log), and
-- the queue for payouts: a 'pending' row is a payment the site still owes and
-- sends on the next page load or trade.
-- Tickets-mode trades use the same pools/positions/trades tables under their own
-- book key (season * 10 + 1), so they never mix with play money.

create table public.market_ticket_moves (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  book int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount bigint not null,                  -- Tickets; negative = taken from the member
  kind text not null check (kind in ('bet', 'sale', 'payout', 'refund')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index market_ticket_moves_pending_idx on public.market_ticket_moves (status, id) where status in ('pending', 'sending');
create index market_ticket_moves_league_idx on public.market_ticket_moves (league_id, book, id desc);
alter table public.market_ticket_moves enable row level security;

-- Only the delivery fields may change; who, how much and why never do, and rows are never deleted.
create function public.market_ticket_moves_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.leagues where id = old.league_id) then raise exception 'market_ticket_moves is append-only'; end if;
    return old;
  end if;
  if new.league_id <> old.league_id or new.book <> old.book or new.user_id <> old.user_id or new.amount <> old.amount
     or new.kind <> old.kind or new.reason <> old.reason or new.created_at <> old.created_at then
    raise exception 'only the status of a Ticket movement can change';
  end if;
  if old.status = 'done' then raise exception 'a finished Ticket movement can''t change'; end if;
  return new;
end;
$$;
create trigger market_ticket_moves_guard before update or delete on public.market_ticket_moves
  for each row execute function public.market_ticket_moves_guard();

-- A Tickets trade. Buys: the app has already taken p_amount Tickets from UnbelievaBoat,
-- so this records the bet as done. Sells: records the sale and queues the payment, in
-- the same transaction. Returns 'ok', 'stale' (someone traded first) or 'qty'.
create function public.market_trade_tickets(
  p_league uuid, p_book int, p_user uuid, p_market text, p_outcome text, p_side text, p_kind text,
  p_qty numeric, p_amount numeric, p_expected_net numeric, p_new_net numeric,
  p_price_before numeric, p_price_after numeric, p_reason text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_pos public.market_positions%rowtype;
begin
  if p_side not in ('yes', 'no') or p_kind not in ('buy', 'sell') or p_qty <= 0 or p_amount < 0 then return 'bad'; end if;
  insert into market_pools (league_id, season, market_key, outcome_id) values (p_league, p_book, p_market, p_outcome) on conflict do nothing;
  select net into v_net from market_pools where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome for update;
  if abs(v_net - p_expected_net) > 0.0001 then return 'stale'; end if;
  select * into v_pos from market_positions where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side for update;

  if p_kind = 'buy' then
    insert into market_positions (league_id, season, user_id, market_key, outcome_id, side, qty, cost)
      values (p_league, p_book, p_user, p_market, p_outcome, p_side, p_qty, p_amount)
      on conflict (league_id, season, user_id, market_key, outcome_id, side)
      do update set qty = market_positions.qty + excluded.qty, cost = market_positions.cost + excluded.cost;
    insert into market_ticket_moves (league_id, book, user_id, amount, kind, reason, status, done_at)
      values (p_league, p_book, p_user, -round(p_amount), 'bet', p_reason, 'done', now());
  else
    if v_pos.qty is null or v_pos.qty < p_qty - 0.0001 then return 'qty'; end if;
    if v_pos.qty - p_qty < 0.0001 then
      delete from market_positions where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    else
      update market_positions set qty = qty - p_qty, cost = round(cost * (qty - p_qty) / qty, 2)
        where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    end if;
    if p_amount > 0 then
      insert into market_ticket_moves (league_id, book, user_id, amount, kind, reason) values (p_league, p_book, p_user, round(p_amount), 'sale', p_reason);
    end if;
  end if;

  update market_pools set net = p_new_net, volume = volume + p_amount, updated_at = now()
    where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome;
  insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount, price_before, price_after)
    values (p_league, p_book, p_user, p_market, p_outcome, p_side, p_kind, p_qty, p_amount, p_price_before, p_price_after);
  return 'ok';
end;
$$;

-- Settles a finished outcome in Tickets: logs every position, closes them, and queues
-- p_per_contract Tickets per contract for the winning side.
create function public.market_settle_tickets(p_league uuid, p_book int, p_market text, p_outcome text, p_winner text, p_per_contract int, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pay numeric;
begin
  for r in select * from market_positions where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome for update loop
    pay := case when r.side = p_winner then r.qty * p_per_contract else 0 end;
    insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount)
      values (p_league, p_book, r.user_id, p_market, p_outcome, r.side, 'settle', r.qty, pay);
    if pay > 0 then
      insert into market_ticket_moves (league_id, book, user_id, amount, kind, reason) values (p_league, p_book, r.user_id, round(pay), 'payout', p_reason);
    end if;
    n := n + 1;
  end loop;
  delete from market_positions where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome;
  return n;
end;
$$;

revoke execute on function public.market_trade_tickets(uuid, int, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke execute on function public.market_settle_tickets(uuid, int, text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.market_trade_tickets(uuid, int, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text) to service_role;
grant execute on function public.market_settle_tickets(uuid, int, text, text, text, int, text) to service_role;
grant select, insert, update on public.market_ticket_moves to service_role;
grant usage, select on all sequences in schema public to service_role;
notify pgrst, 'reload schema';
