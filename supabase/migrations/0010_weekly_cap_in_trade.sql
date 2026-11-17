-- Weekly bet cap checked inside the trade itself (Fable review, 2026-11-16).
--
-- The per-member weekly cap (/betcap) was checked by the app before the trade, outside the
-- database's lock: two bets sent at the same moment (site + Discord, or a double tap) each saw the
-- other missing and both went through, past the cap. market_trade2 now takes the cap and the start
-- of the league's Madden week and checks it under the member's own lock.
--
-- Same function as 0008 plus p_week_cap / p_week_since and the 'weekcap' answer. The app still
-- works before this has run (it falls back to the older call, with the older, racy check).
--
-- Run once in the Supabase SQL editor, after 0008. Safe to re-run.

drop function if exists public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb, boolean, numeric);
drop function if exists public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb, boolean, numeric, numeric, timestamptz);

create or replace function public.market_trade2(
  p_league uuid, p_book int, p_user uuid, p_market text, p_outcome text, p_side text, p_kind text,
  p_qty numeric, p_amount numeric, p_expected jsonb, p_new_net numeric,
  p_price_before numeric, p_price_after numeric, p_tickets boolean, p_balance numeric, p_conflicts jsonb,
  p_cashout boolean default false,
  p_prepaid numeric default 0,
  p_week_cap numeric default null,          -- the league's per-member weekly cap (null = none)
  p_week_since timestamptz default null     -- when the league's current Madden week started
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pos public.market_positions%rowtype; v_cash numeric; v_avail numeric; v_part numeric; v_refund numeric; v_amount numeric; v_prep numeric := 0; v_owed numeric := 0; v_week numeric := 0;
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
    -- Weekly cap, checked here under the member's lock (taken above), so two bets sent at the same
    -- moment can't both fit under it: stakes placed since the week started minus what cancels and
    -- cash-outs gave back, the same sum the site shows.
    if p_week_cap is not null and p_week_since is not null then
      select greatest(0, coalesce(sum(case when kind = 'buy' then amount else -amount end), 0)) into v_week
        from market_trades where league_id = p_league and user_id = p_user and kind in ('buy', 'sell') and created_at >= p_week_since;
      if v_week + p_amount > p_week_cap then return jsonb_build_object('r', 'weekcap', 'amount', v_week); end if;
    end if;
    v_amount := p_amount;
    if p_tickets and p_prepaid >= p_amount then
      null; -- the stake was already taken from UnbelievaBoat (checked against the balance before that)
    elsif p_tickets then
      v_avail := p_balance
        - coalesce((select sum(cost - prepaid) from market_positions where league_id = p_league and user_id = p_user and season % 10 = 1), 0)
        + coalesce((select sum(amount) from market_ledger where league_id = p_league and user_id = p_user and applied_at is null), 0);
      if v_avail < p_amount then return jsonb_build_object('r', 'cash', 'amount', floor(v_avail)); end if;
    else
      insert into market_wallets (league_id, season, user_id) values (p_league, p_book, p_user) on conflict do nothing;
      select cash into v_cash from market_wallets where league_id = p_league and season = p_book and user_id = p_user for update;
      if v_cash < p_amount then return jsonb_build_object('r', 'cash', 'amount', v_cash); end if;
      update market_wallets set cash = cash - p_amount where league_id = p_league and season = p_book and user_id = p_user;
    end if;
    insert into market_positions (league_id, season, user_id, market_key, outcome_id, side, qty, cost, prepaid)
      values (p_league, p_book, p_user, p_market, p_outcome, p_side, p_qty, p_amount, least(p_prepaid, p_amount))
      on conflict (league_id, season, user_id, market_key, outcome_id, side)
      do update set qty = market_positions.qty + excluded.qty, cost = market_positions.cost + excluded.cost, prepaid = market_positions.prepaid + excluded.prepaid;
  else
    if v_pos.qty is null or v_pos.qty < p_qty - 0.0001 then return jsonb_build_object('r', 'qty'); end if;
    v_part := case when p_qty >= v_pos.qty - 0.0001 then v_pos.cost else round(v_pos.cost * p_qty / v_pos.qty, 2) end;
    v_prep := case when p_qty >= v_pos.qty - 0.0001 then v_pos.prepaid else round(v_pos.prepaid * p_qty / v_pos.qty, 2) end;
    -- futures cash out at the market price (more or less than the stake); other cancels never return more than the stake
    v_refund := case when p_cashout then round(p_amount, 2) else least(v_part, round(p_amount, 2)) end;
    v_amount := v_refund;
    if v_pos.qty - p_qty < 0.0001 then
      delete from market_positions where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    else
      update market_positions set qty = qty - p_qty, cost = cost - v_part, prepaid = prepaid - v_prep
        where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    end if;
    if p_tickets then
      -- what the member is owed now: the refund, less the part of the stake never taken from UnbelievaBoat.
      -- Owed > 0 is sent back to UnbelievaBoat by the app straight away; owed < 0 (old bets whose stake was
      -- never taken) goes to the payouts report.
      v_owed := v_refund - v_part + v_prep;
      if v_owed < -0.005 then
        insert into market_ledger (league_id, book, user_id, kind, market_key, outcome_id, side, qty, cost, payout, amount, note)
          values (p_league, p_book, p_user, case when p_cashout then 'cashout' else 'cancel' end, p_market, p_outcome, p_side, p_qty, v_part, v_refund, v_owed,
                  case when p_cashout then 'Cashed out at the market price' else 'Cancelled after the price moved against it' end);
      end if;
    else
      update market_wallets set cash = cash + v_refund where league_id = p_league and season = p_book and user_id = p_user;
    end if;
  end if;

  update market_pools set net = p_new_net, volume = volume + v_amount, updated_at = now()
    where league_id = p_league and season = p_book and market_key = p_market and outcome_id = p_outcome;
  insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount, price_before, price_after)
    values (p_league, p_book, p_user, p_market, p_outcome, p_side, p_kind, p_qty, v_amount, p_price_before, p_price_after);
  return jsonb_build_object('r', 'ok', 'amount', v_amount, 'credit', greatest(v_owed, 0));
end;
$$;

revoke execute on function public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb, boolean, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb, boolean, numeric, numeric, timestamptz) to service_role;

create index if not exists market_trades_user_week_idx on public.market_trades (league_id, user_id, created_at);

notify pgrst, 'reload schema';
