-- CFM Manager: initial schema.
-- Run once in the Supabase SQL editor (or with `supabase db push`).
--
-- Security model
-- - Browsers talk to Supabase with the public anon key, so every table has
--   row-level security. Reads are allowed only where the policies below say so.
-- - All writes go through the app's server routes, which use the service-role
--   key after checking who the user is. No insert/update/delete policies exist
--   for the anon or authenticated roles on purpose.
-- - ea_connections holds EA sessions. Tokens are encrypted by the app
--   (AES-256-GCM, key in the EA_TOKEN_KEY env var) before they reach the
--   database, and the table has no read policy at all: only the server and the
--   sync worker (service role) can see it.

create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- Create a profile row automatically when someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- EA connections (one per EA persona a user signs in with) ----------
create table public.ea_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  persona_id bigint not null,
  persona_name text not null,
  console text not null,               -- ps5, xbsx, pc, ...
  token_ciphertext text not null,      -- encrypted {accessToken, refreshToken, expiry, console}
  status text not null default 'ok',   -- ok | expired (user must reconnect)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, persona_id, console)
);

-- ---------- leagues ----------
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null,
  ea_league_id bigint not null,
  console text not null,
  owner_id uuid not null references auth.users (id),
  ea_connection_id uuid references public.ea_connections (id) on delete set null,
  is_public boolean not null default true,
  settings jsonb not null default '{}'::jsonb,   -- per-league options (rules page, projected caps, ...)
  last_sync_key text,
  last_synced_at timestamptz,
  last_sync_status text,                          -- synced | unchanged | failed | pending
  created_at timestamptz not null default now(),
  unique (ea_league_id, console)
);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('commissioner', 'member')),
  team_abbr text,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text,          -- synced | unchanged | failed
  sync_key text,
  report text
);
create index sync_runs_league_idx on public.sync_runs (league_id, started_at desc);

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.ea_connections enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.sync_runs enable row level security;

create function public.is_member(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.league_members m where m.league_id = l and m.user_id = auth.uid());
$$;

create policy "own profile" on public.profiles
  for select using (id = auth.uid());

-- ea_connections: intentionally no policies. Only the service role can read it.

create policy "public or member leagues" on public.leagues
  for select using (is_public or public.is_member(id));

create policy "members of visible leagues" on public.league_members
  for select using (
    exists (select 1 from public.leagues l where l.id = league_id and (l.is_public or public.is_member(l.id)))
  );

create policy "sync history of visible leagues" on public.sync_runs
  for select using (
    exists (select 1 from public.leagues l where l.id = league_id and (l.is_public or public.is_member(l.id)))
  );

-- ---------- Data API access ----------
-- New Supabase projects can be set not to expose new tables to the API
-- automatically, so grant exactly what the policies above expect.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.leagues, public.league_members, public.sync_runs to anon, authenticated;
grant select on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.is_member(uuid) to anon, authenticated;

-- ---------- storage: each league's built data ----------
-- league-data/<slug>/data.json is what the league pages load. Public read;
-- the worker writes with the service role.
insert into storage.buckets (id, name, public)
values ('league-data', 'league-data', true)
on conflict (id) do nothing;
