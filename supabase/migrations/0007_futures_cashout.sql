-- Cash out for futures (Nick, 2026-11-14: "a cash out system for futures bets so people cant jump
-- ship and get all their money back late"). Season-long bets (Super Bowl, conference, division,
-- awards, leaders, win totals, playoff spots) no longer cancel; they cash out at the current market
-- price, which can be more or less than the stake. Game and prop bets still cancel until kickoff
-- (what they cost, or their market value if that's less).
-- Adds p_cashout to market_trade2 and the 'cashout' ledger kind. Run once in the SQL editor; safe to re-run.

alter table public.market_ledger drop constraint if exists market_ledger_kind_check;
alter table public.market_ledger add constraint market_ledger_kind_check check (kind in ('result', 'cancel', 'cashout', 'void', 'credit'));

drop function if exists public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb);

create or replace function public.market_trade2(
  p_league uuid, p_book int, p_user uuid, p_market text, p_outcome text, p_side text, p_kind text,
  p_qty numeric, p_amount numeric, p_expected jsonb, p_new_net numeric,
  p_price_before numeric, p_price_after numeric, p_tickets boolean, p_balance numeric, p_conflicts jsonb,
  p_cashout boolean default false
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
    -- futures cash out at the market price (more or less than the stake); other cancels never return more than the stake
    v_refund := case when p_cashout then round(p_amount, 2) else least(v_part, round(p_amount, 2)) end;
    v_amount := v_refund;
    if v_pos.qty - p_qty < 0.0001 then
      delete from market_positions where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    else
      update market_positions set qty = qty - p_qty, cost = cost - v_part
        where league_id = p_league and season = p_book and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    end if;
    if p_tickets then
      if p_cashout and abs(v_refund - v_part) >= 0.005 then
        insert into market_ledger (league_id, book, user_id, kind, market_key, outcome_id, side, qty, cost, payout, amount, note)
          values (p_league, p_book, p_user, 'cashout', p_market, p_outcome, p_side, p_qty, v_part, v_refund, v_refund - v_part, 'Cashed out at the market price');
      elsif not p_cashout and v_refund < v_part then
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

revoke execute on function public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.market_trade2(uuid, int, uuid, text, text, text, text, numeric, numeric, jsonb, numeric, numeric, numeric, boolean, numeric, jsonb, boolean) to service_role;

notify pgrst, 'reload schema';
