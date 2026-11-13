-- One CFM Manager site per EA league, whatever console added it (2026-11-13).
-- Cross-play leagues share one EA league id on every platform; the old
-- unique (ea_league_id, console) let a PC player create a second copy of a PS5
-- league. Run after merging any copies (the "Merge duplicate leagues" workflow),
-- otherwise the new index can't be created.
alter table public.leagues drop constraint if exists leagues_ea_league_id_console_key;
create unique index if not exists leagues_ea_league_id_key on public.leagues (ea_league_id);
