-- One-off (Nick, 2026-11-14): wipe NCL's test betting before the league moves to its main Discord.
-- Removes every bet, position, pool, payout line, Ticket move, kickoff, odds-history point and
-- play-money wallet for NCL only. League data, members, Discord link and settings are untouched.
-- The history tables are append-only by trigger, so triggers are switched off for this
-- transaction only (session_replication_role = replica; that also skips FK cascades, hence the order).
begin;
set local session_replication_role = replica;

create temp table _ncl on commit drop as select id from public.leagues where slug = 'ncl';

delete from public.market_trade_voids  where league_id in (select id from _ncl);
delete from public.market_ledger       where league_id in (select id from _ncl);
delete from public.market_ticket_moves where league_id in (select id from _ncl);
delete from public.market_trades       where league_id in (select id from _ncl);
delete from public.market_positions    where league_id in (select id from _ncl);
delete from public.market_pools        where league_id in (select id from _ncl);
delete from public.market_wallets      where league_id in (select id from _ncl);
delete from public.market_game_close   where league_id in (select id from _ncl);
delete from public.market_price_points where league_id in (select id from _ncl);

-- Forget the per-week cap clock so the main server starts a fresh week.
update public.leagues set settings = settings - 'marketWeek' where id in (select id from _ncl);

commit;

-- Check: every count should be 0.
select
  (select count(*) from public.market_trades       t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as trades,
  (select count(*) from public.market_positions    t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as positions,
  (select count(*) from public.market_ledger       t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as ledger,
  (select count(*) from public.market_ticket_moves t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as ticket_moves,
  (select count(*) from public.market_pools        t join public.leagues l on l.id = t.league_id where l.slug = 'ncl') as pools;
