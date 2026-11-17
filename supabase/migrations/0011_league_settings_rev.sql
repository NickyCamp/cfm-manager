-- League settings: stop two saves a moment apart from losing one of them (Fable review, 2026-11-16).
--
-- leagues.settings is one JSON blob holding every per-league option (Discord link, bet caps, house
-- rules, award winners, Discord channel ids, sync requests...). Each writer read the whole blob,
-- changed its part and wrote the whole blob back, so the later of two close writes silently put
-- back the other's old copy.
--
-- settings_rev is a counter the database bumps every time settings changes. The app now writes
-- settings only "if settings_rev is still what I read" and otherwise reads again and redoes its
-- change (src/lib/leagueSettingsCore.ts). The app works without this migration, just unprotected.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.leagues add column if not exists settings_rev bigint not null default 0;

create or replace function public.leagues_bump_settings_rev() returns trigger
language plpgsql as $$
begin
  if new.settings is distinct from old.settings then
    new.settings_rev := old.settings_rev + 1;
  else
    new.settings_rev := old.settings_rev; -- nobody sets the counter by hand
  end if;
  return new;
end $$;

drop trigger if exists leagues_bump_settings_rev on public.leagues;
create trigger leagues_bump_settings_rev before update on public.leagues
  for each row execute function public.leagues_bump_settings_rev();

notify pgrst, 'reload schema';
