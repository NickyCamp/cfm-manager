-- Markets tab: shared play-money trading (Nick, 2026-11-13).
-- Prices move with what league members buy and sell (a market maker on top of
-- the simulation's chance), so early bets lock in better prices.
-- One wallet per member per league per season ($1,000 to start).
-- Only the server (service role) reads or writes these tables; every trade goes
-- through market_trade(), which locks the pool row so two people buying at the
-- same moment can't both get the old price.

create table public.market_wallets (
  league_id uuid not null references public.leagues (id) on delete cascade,
  season int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  cash numeric(12,2) not null default 1000,
  created_at timestamptz not null default now(),
  primary key (league_id, season, user_id)
);

-- net = Yes contracts bought minus No contracts bought (sells reverse), all members.
create table public.market_pools (
  league_id uuid not null references public.leagues (id) on delete cascade,
  season int not null,
  market_key text not null,
  outcome_id text not null,
  net numeric(14,4) not null default 0,
  volume numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (league_id, season, market_key, outcome_id)
);

create table public.market_positions (
  league_id uuid not null references public.leagues (id) on delete cascade,
  season int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  market_key text not null,
  outcome_id text not null,
  side text not null check (side in ('yes', 'no')),
  qty numeric(14,4) not null,
  cost numeric(12,2) not null,
  primary key (league_id, season, user_id, market_key, outcome_id, side)
);

create table public.market_trades (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  season int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  market_key text not null,
  outcome_id text not null,
  side text not null,
  kind text not null check (kind in ('buy', 'sell', 'settle')),
  qty numeric(14,4) not null,
  amount numeric(12,2) not null,
  price_before numeric(6,4),
  price_after numeric(6,4),
  created_at timestamptz not null default now()
);
create index market_trades_league_idx on public.market_trades (league_id, season, created_at desc);

alter table public.market_wallets enable row level security;
alter table public.market_pools enable row level security;
alter table public.market_positions enable row level security;
alter table public.market_trades enable row level security;
-- no policies: only the service role (the app's server) can touch them

-- One buy or sell. The app works out qty/amount/new net from the price it read
-- (expected_net); if someone traded in between, this returns 'stale' and the app retries.
create function public.market_trade(
  p_league uuid, p_season int, p_user uuid, p_market text, p_outcome text, p_side text, p_kind text,
  p_qty numeric, p_amount numeric, p_expected_net numeric, p_new_net numeric, p_price_before numeric, p_price_after numeric
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_net numeric; v_cash numeric; v_pos public.market_positions%rowtype;
begin
  if p_side not in ('yes', 'no') or p_kind not in ('buy', 'sell') or p_qty <= 0 or p_amount < 0 then return 'bad'; end if;
  insert into market_pools (league_id, season, market_key, outcome_id) values (p_league, p_season, p_market, p_outcome) on conflict do nothing;
  select net into v_net from market_pools where league_id = p_league and season = p_season and market_key = p_market and outcome_id = p_outcome for update;
  if abs(v_net - p_expected_net) > 0.0001 then return 'stale'; end if;
  insert into market_wallets (league_id, season, user_id) values (p_league, p_season, p_user) on conflict do nothing;
  select cash into v_cash from market_wallets where league_id = p_league and season = p_season and user_id = p_user for update;
  select * into v_pos from market_positions where league_id = p_league and season = p_season and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side for update;

  if p_kind = 'buy' then
    if v_cash < p_amount then return 'cash'; end if;
    update market_wallets set cash = cash - p_amount where league_id = p_league and season = p_season and user_id = p_user;
    insert into market_positions (league_id, season, user_id, market_key, outcome_id, side, qty, cost)
      values (p_league, p_season, p_user, p_market, p_outcome, p_side, p_qty, p_amount)
      on conflict (league_id, season, user_id, market_key, outcome_id, side)
      do update set qty = market_positions.qty + excluded.qty, cost = market_positions.cost + excluded.cost;
  else
    if v_pos.qty is null or v_pos.qty < p_qty - 0.0001 then return 'qty'; end if;
    update market_wallets set cash = cash + p_amount where league_id = p_league and season = p_season and user_id = p_user;
    if v_pos.qty - p_qty < 0.0001 then
      delete from market_positions where league_id = p_league and season = p_season and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    else
      update market_positions set qty = qty - p_qty, cost = round(cost * (qty - p_qty) / qty, 2)
        where league_id = p_league and season = p_season and user_id = p_user and market_key = p_market and outcome_id = p_outcome and side = p_side;
    end if;
  end if;

  update market_pools set net = p_new_net, volume = volume + p_amount, updated_at = now()
    where league_id = p_league and season = p_season and market_key = p_market and outcome_id = p_outcome;
  insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount, price_before, price_after)
    values (p_league, p_season, p_user, p_market, p_outcome, p_side, p_kind, p_qty, p_amount, p_price_before, p_price_after);
  return 'ok';
end;
$$;

-- Pays out every open position on a finished outcome ($1 a contract to the winning side) and closes them.
create function public.market_settle(p_league uuid, p_season int, p_market text, p_outcome text, p_winner text)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from market_positions where league_id = p_league and season = p_season and market_key = p_market and outcome_id = p_outcome for update loop
    if r.side = p_winner then
      insert into market_wallets (league_id, season, user_id) values (p_league, p_season, r.user_id) on conflict do nothing;
      update market_wallets set cash = cash + r.qty where league_id = p_league and season = p_season and user_id = r.user_id;
    end if;
    insert into market_trades (league_id, season, user_id, market_key, outcome_id, side, kind, qty, amount)
      values (p_league, p_season, r.user_id, p_market, p_outcome, r.side, 'settle', r.qty, case when r.side = p_winner then r.qty else 0 end);
    n := n + 1;
  end loop;
  delete from market_positions where league_id = p_league and season = p_season and market_key = p_market and outcome_id = p_outcome;
  return n;
end;
$$;

revoke execute on function public.market_trade(uuid, int, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.market_settle(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.market_trade(uuid, int, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.market_settle(uuid, int, text, text, text) to service_role;

-- Public audit log (Nick, 2026-11-13): every trade by every member is shown on the
-- league's Markets activity page and can't be edited or removed afterwards, not even
-- by the app. (Rows only go away if the whole league is deleted.)
create function public.market_trades_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then raise exception 'market_trades is append-only'; end if;
  if exists (select 1 from public.leagues where id = old.league_id) then
    raise exception 'market_trades is append-only';
  end if;
  return old;
end;
$$;
create trigger market_trades_no_edits before update or delete on public.market_trades
  for each row execute function public.market_trades_append_only();

-- Kickoff / betting close times for game and player-prop markets (Nick, 2026-11-13):
-- people schedule games in chat, so anyone in the league can set when a game's
-- markets close (Discord /kickoff or the market page). Every change is a new row,
-- shown publicly with who set it; the latest row per game is the one in force.
create table public.market_game_close (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  season int not null,
  game_id bigint not null,
  close_at timestamptz not null,
  set_by_kind text not null check (set_by_kind in ('site', 'discord')),
  set_by_id text not null,
  set_by_name text not null,
  created_at timestamptz not null default now()
);
create index market_game_close_idx on public.market_game_close (league_id, season, game_id, id desc);
alter table public.market_game_close enable row level security;
create trigger market_game_close_no_edits before update or delete on public.market_game_close
  for each row execute function public.market_trades_append_only();
