-- Raw EA pulls move to a private bucket (Fable review, 2026-11-16).
--
-- Each sync saves the raw EA pull so the pages can be rebuilt later without asking EA again. It was
-- saved in the public league-data bucket (league-data/<slug>/raw.json.gz), so anyone who knew a
-- league's web address could download it, and it includes the league hub's member list with
-- members' EA account details. Only the sync worker ever reads it.
--
-- This makes a private bucket, league-raw. There are no storage policies for it on purpose: with
-- none, only the service role (the worker) can read or write it. The worker copies each league's
-- existing raw pull across and deletes the public copy on its next run.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

insert into storage.buckets (id, name, public)
values ('league-raw', 'league-raw', false)
on conflict (id) do update set public = false;
