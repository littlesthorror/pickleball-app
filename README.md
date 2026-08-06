# Picklr — Huntingdon Pickleball

A club match-rating web app: Glicko-2 ratings, a leaderboard, match entry
for admins, player profiles with photos, an events calendar, notices, and
an FAQ page.

## Stack

- React + TypeScript + Vite, packaged as a PWA (installable on phones)
- Supabase: Postgres database, Google-login auth, Storage (avatars +
  notice attachments), and two Edge Functions (`confirm-match`,
  `reset-player`) that do all rating writes server-side

## Running it locally

```
npm install
npm run dev
```

You'll need a `.env` file in this folder (same level as `package.json`)
with:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

See `GETTING_STARTED.md` for a fuller walkthrough if you're new to this.

## Project layout

- `src/pages/` — one file per screen (Dashboard, Leaderboard, MatchEntry,
  AdminManagement, Profile, Events, FAQ, Notices, ClubStats, PlayerDetail,
  Login)
- `src/components/` — shared bits (Avatar, ShareCard)
- `src/lib/` — pure logic with no UI: rating prediction, badges, birthday
  check, URL linkifying, share-card image rendering
- `supabase/migrations/` — the full schema history, in order
- `supabase/functions/` — the two server-side Edge Functions

## Rating math

Glicko-2, adapted for 2v2 doubles: each team's rating/RD/volatility is the
simple average of its two players, and margin of victory is encoded as
`own_score / (own_score + opponent_score)` fed in as the Glicko-2 "actual
score." Both confirmed by reading the club's original spreadsheet's Apps
Script source directly — see the comments at the top of
`supabase/functions/confirm-match/index.ts`.
