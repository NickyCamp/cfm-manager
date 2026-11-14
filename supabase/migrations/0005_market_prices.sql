-- Price history for the markets (Nick, 2026-11-13): one row each time a market's prices
-- move (a bet, or the weekly sync changing the model). Drives the "odds over time" charts
-- for season-long markets. Append-only, like the trade log.

create table public.market_price_points (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  book int not null,
  market_key text not null,
  prices jsonb not null,                   -- { outcomeId: chance 0..1 }
  cause text not null default 'sync' check (cause in ('sync', 'bet')),
  created_at timestamptz not null default now()
);
create index market_price_points_idx on public.market_price_points (league_id, book, market_key, id);
alter table public.market_price_points enable row level security;

create function public.market_price_points_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.leagues where id = old.league_id) then return old; end if;
  raise exception 'market_price_points is append-only';
end $$;
create trigger market_price_points_guard before update or delete on public.market_price_points
  for each row execute function public.market_price_points_guard();

-- The newest row of every market in a book (to skip writing prices that haven't moved).
create function public.market_price_latest(p_league uuid, p_book int)
returns table (market_key text, prices jsonb, created_at timestamptz)
language sql stable as $$
  select distinct on (market_key) market_key, prices, created_at
  from public.market_price_points where league_id = p_league and book = p_book
  order by market_key, id desc
$$;

grant all on public.market_price_points to service_role;
grant execute on function public.market_price_latest(uuid, int) to service_role;
notify pgrst, 'reload schema';
