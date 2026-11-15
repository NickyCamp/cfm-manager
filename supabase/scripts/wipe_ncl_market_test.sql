-- One-off (Nick, 2026-11-14): wipe NCL's test betting before the league moves to its main Discord.
-- One DO block = one transaction. The append-only guard triggers are disabled and re-enabled
-- inside it (Supabase doesn't allow session_replication_role); if anything fails, all of it,
-- including the disable, rolls back.
do $$
declare
  lid uuid := (select id from public.leagues where slug = 'ncl');
  g text[] := array[
    'market_trades:market_trades_no_edits', 'market_game_close:market_game_close_no_edits',
    'market_price_points:market_price_points_guard', 'market_ticket_moves:market_ticket_moves_guard',
    'market_ledger:market_ledger_guard', 'market_trade_voids:market_trade_voids_no_edits'];
  x text;
begin
  if lid is null then raise exception 'No league with slug ncl'; end if;
  foreach x in array g loop
    execute format('alter table public.%I disable trigger %I', split_part(x, ':', 1), split_part(x, ':', 2));
  end loop;
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
  foreach x in array g loop
    execute format('alter table public.%I enable trigger %I', split_part(x, ':', 1), split_part(x, ':', 2));
  end loop;
end $$;

-- Check: every count should be 0, and guards_on should be 6.
select
  (select count(*) from public.market_trades       t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as trades,
  (select count(*) from public.market_positions    t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as positions,
  (select count(*) from public.market_ledger       t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as ledger,
  (select count(*) from public.market_ticket_moves t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as ticket_moves,
  (select count(*) from public.market_pools        t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as pools,
  (select count(*) from pg_trigger where tgname in ('market_trades_no_edits','market_game_close_no_edits','market_price_points_guard',
     'market_ticket_moves_guard','market_ledger_guard','market_trade_voids_no_edits') and tgenabled = 'O') as guards_on;
