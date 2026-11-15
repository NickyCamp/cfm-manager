-- One-off (Nick, 2026-11-14): wipe NCL's test betting before the league moves to its main Discord.
-- One DO block = one transaction (the SQL editor runs statements separately, so a temp table
-- or BEGIN/COMMIT across statements doesn't work). Append-only triggers are off for this
-- transaction only; that also skips FK cascades, hence the delete order.
do $$
declare lid uuid := (select id from public.leagues where slug = 'ncl');
begin
  if lid is null then raise exception 'No league with slug ncl'; end if;
  perform set_config('session_replication_role', 'replica', true);
  delete from public.market_trade_voids  where league_id = lid;
  delete from public.market_ledger       where league_id = lid;
  delete from public.market_ticket_moves where league_id = lid;
  delete from public.market_trades       where league_id = lid;
  delete from public.market_positions    where league_id = lid;
  delete from public.market_pools        where league_id = lid;
  delete from public.market_wallets      where league_id = lid;
  delete from public.market_game_close   where league_id = lid;
  delete from public.market_price_points where league_id = lid;
  update public.leagues set settings = settings - 'marketWeek' where id = lid;
  perform set_config('session_replication_role', 'origin', true);
end $$;

-- Check: every count should be 0.
select
  (select count(*) from public.market_trades       t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as trades,
  (select count(*) from public.market_positions    t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as positions,
  (select count(*) from public.market_ledger       t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as ledger,
  (select count(*) from public.market_ticket_moves t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as ticket_moves,
  (select count(*) from public.market_pools        t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as pools;
