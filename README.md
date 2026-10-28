# CFM Manager

A home for Madden Connected Franchise leagues. Anyone in a league signs in, connects their EA account, picks the league, and CFM Manager keeps it synced from EA and builds its pages (standings, scores, cap space, contracts, transactions). Installable on phones as a web app; App Store / Play builds come later via Capacitor.

## Pieces
- **App** (`src/`): Next.js on Vercel. Email sign-in (Supabase), the Connect EA flow (`/connect`), My leagues (`/dashboard`), league pages (`/l/<slug>`).
- **Database** (`supabase/migrations/`): Supabase Postgres with row-level security. EA sessions are encrypted (AES-256-GCM) before they're stored and are only readable by the server and the worker.
- **Sync worker** (`worker/`, `.github/workflows/sync-leagues.yml`): GitHub Actions every 3 hours. For each league it refreshes the EA session, checks whether the league moved, and if so pulls everything into `league-data/<slug>/raw.json.gz` in Supabase Storage.

The EA code is ported from the NCL sync engine (`ncl-sync/ea/sync.mjs`), which was adapted from [snallabot](https://github.com/snallabot/snallabot-service) (MIT License, Copyright (c) 2024 snallabot).

## Live
- App: Vercel project `cfm-manager` (team CFM Manager)
- Database: Supabase project `cfm-manager` (East US)

## Setup
1. **Supabase:** create a project. In the SQL editor, run `supabase/migrations/0001_init.sql`. Under Authentication → URL configuration, set the Site URL to the Vercel address and add `<site>/auth/callback` as a redirect URL.
2. **Vercel:** import this repo. Add the env vars from `.env.example`.
3. **GitHub Actions secrets** (Settings → Secrets → Actions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EA_CLIENT_SECRET`, `EA_TOKEN_KEY` (same value as in Vercel).

## Local development
```
cp .env.example .env.local   # fill in
npm install
npm run dev
npm run sync                  # run the worker once (needs the same env vars)
```

## Every Madden year
Update `src/lib/ea/constants.ts` (client id, year) and the `EA_CLIENT_SECRET` secret from snallabot's `ea_constants.ts`.
