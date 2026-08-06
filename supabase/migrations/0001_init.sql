-- Pickleball club rating app — initial schema
-- Generated from PROJECT_BRIEF.md data model, with two adaptations explained
-- in comments below (google_account_id, and a new match_participant_ratings
-- table). Both are flagged so they can be reviewed/reverted.

create extension if not exists "pgcrypto";

-- ── PLAYERS ─────────────────────────────────────────────────────────────
-- One row per club member.
--
-- ADAPTATION: the brief lists a separate `google_account_id` field on
-- Player. Supabase Auth already creates a row in `auth.users` for every
-- Google login, with its own uuid. Rather than duplicating that id in a
-- second column, this table's `id` IS that auth.users id directly
-- (players.id references auth.users.id). Net effect is the same — every
-- player is tied to their Google login — just without a redundant column.
create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  date_joined timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── PLAYER RATINGS ──────────────────────────────────────────────────────
-- Current Glicko-2 state per player. Kept in its own table (rather than as
-- columns on `players`) because it changes after every confirmed match,
-- while `players` is closer to a profile table.
--
-- Defaults are standard Glicko-2 starting values: rating 1500, RD 350,
-- volatility 0.06. Every player — including ones who join later — starts
-- here, matching the brief's "fresh start at 1500" decision.
create table public.player_ratings (
  player_id uuid primary key references public.players (id) on delete cascade,
  rating numeric not null default 1500,
  rd numeric not null default 350,
  volatility numeric not null default 0.06,
  games_played int not null default 0,
  updated_at timestamptz not null default now()
);

-- ── MATCHES ─────────────────────────────────────────────────────────────
create type match_status as enum ('pending', 'confirmed', 'disputed');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  played_at timestamptz not null default now(),

  team_a_player_1_id uuid not null references public.players (id),
  team_a_player_2_id uuid not null references public.players (id),
  team_b_player_1_id uuid not null references public.players (id),
  team_b_player_2_id uuid not null references public.players (id),

  team_a_score int not null,
  team_b_score int not null,

  -- Team-level pre/post snapshots, as listed in the brief. Kept mainly for
  -- validating our rating math against the old spreadsheet's "Elo Debug"
  -- tab once that's accessible — that tab is expected to work in team-level
  -- terms.
  team_a_pre_rating numeric,
  team_a_pre_rd numeric,
  team_b_pre_rating numeric,
  team_b_pre_rd numeric,
  team_a_post_rating numeric,
  team_a_post_rd numeric,
  team_b_post_rating numeric,
  team_b_post_rd numeric,

  submitted_by uuid not null references public.players (id),
  confirmed_by uuid references public.players (id),
  status match_status not null default 'pending',

  created_at timestamptz not null default now()
);

-- ── MATCH PARTICIPANT RATINGS ───────────────────────────────────────────
-- ADAPTATION / ADDITION: not in the brief's original field list. The
-- brief's team-level columns above don't give a per-PLAYER number, but the
-- individual dashboard screen needs one (rating-over-time chart per
-- player, "games since joining" x-axis, confidence band from RD). This
-- table stores one row per player per match — the actual source of truth
-- for each player's rating history.
create table public.match_participant_ratings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id),
  team text not null check (team in ('a', 'b')),
  pre_rating numeric not null,
  pre_rd numeric not null,
  post_rating numeric,
  post_rd numeric,
  unique (match_id, player_id)
);

-- ── DERIVED: provisional status ─────────────────────────────────────────
-- PLACEHOLDER threshold (8 games) per the brief — not yet confirmed with
-- the club. Change the `8` below once that's settled.
create view public.player_status as
select
  p.id,
  p.display_name,
  p.date_joined,
  pr.rating,
  pr.rd,
  pr.games_played,
  (pr.games_played < 8) as is_provisional
from public.players p
join public.player_ratings pr on pr.player_id = p.id;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────
-- Starter policies: any logged-in club member can read everything (small,
-- socially-close group — matches the brief's leaning, though "leaderboard
-- visible to all by default?" is still an open question to confirm with
-- the club). Rating updates happen only via the server-side edge function
-- (using the service role key, which bypasses RLS), so there's no public
-- "update rating" policy — nobody can edit ratings directly from the app.
alter table public.players enable row level security;
alter table public.player_ratings enable row level security;
alter table public.matches enable row level security;
alter table public.match_participant_ratings enable row level security;

create policy "players readable by any logged-in member"
  on public.players for select
  using (auth.role() = 'authenticated');

create policy "players can update own profile"
  on public.players for update
  using (auth.uid() = id);

create policy "ratings readable by any logged-in member"
  on public.player_ratings for select
  using (auth.role() = 'authenticated');

create policy "matches readable by any logged-in member"
  on public.matches for select
  using (auth.role() = 'authenticated');

create policy "any member can submit a match"
  on public.matches for insert
  with check (auth.uid() = submitted_by);

create policy "confirming member can update a pending match"
  on public.matches for update
  using (status = 'pending')
  with check (true);

create policy "participant ratings readable by any logged-in member"
  on public.match_participant_ratings for select
  using (auth.role() = 'authenticated');
