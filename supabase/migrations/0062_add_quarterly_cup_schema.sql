-- The Quarterly Cup (2026-09-02, Ben's request) — a standalone fixed-team
-- doubles mini-league, deliberately separate from both Competitions
-- (no knockout stage, just a flat table) and the main Season leaderboard
-- (a different rating-based, permanent system). Teams play every other
-- team twice, on whatever date suits them — there's no pre-scheduled
-- kickoff time, just a target end date. Every game played here is ALSO a
-- real row in `matches` (via quarterly_cup_matches.match_id), so it feeds
-- the same Glicko-2 engine as any normal club match, exactly like
-- Competitions does. Unlike Competitions' privacy model, results/fixtures
-- here are fully public (Ben confirmed this explicitly) — the only privacy
-- consideration is a UI-level default (not RLS) that shows a participant
-- their own outstanding fixtures first, since the point is keeping "what
-- do I still need to play" easy to find, not keeping data private.

create table public.quarterly_cups (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'The Quarterly Cup',
  -- 'setup' (still adding teams) -> 'active' (fixtures generated, games
  -- being played) -> 'completed' (winner crowned, table locked).
  status text not null default 'setup' check (status in ('setup', 'active', 'completed')),
  scoring_system text not null default 'standard' check (scoring_system in ('standard', 'social')),
  double_round_robin boolean not null default true,
  -- Custom end date, only used when mirror_season_end is false.
  end_date date,
  -- When true, the "completes in X days" display and the actual finish
  -- date both come live from the current Season's last day (see
  -- lib/seasons.ts's getSeasonEndInfo) instead of end_date — so it always
  -- tracks the Season boundary even if that logic ever changes, rather
  -- than freezing a copied date at creation time. Added at Ben's explicit
  -- request ("or maybe there's a checkbox for it to mirror the season's
  -- last day").
  mirror_season_end boolean not null default true,
  winner_team_id uuid, -- FK added below, after quarterly_cup_teams exists.
  created_by uuid references public.players(id),
  created_at timestamptz not null default now()
);

create table public.quarterly_cup_teams (
  id uuid primary key default gen_random_uuid(),
  cup_id uuid not null references public.quarterly_cups(id) on delete cascade,
  team_name text,
  player1_id uuid not null references public.players(id),
  player2_id uuid not null references public.players(id),
  created_at timestamptz not null default now(),
  check (player1_id <> player2_id)
);

alter table public.quarterly_cups
  add constraint quarterly_cups_winner_team_id_fkey
  foreign key (winner_team_id) references public.quarterly_cup_teams(id);

create table public.quarterly_cup_matches (
  id uuid primary key default gen_random_uuid(),
  cup_id uuid not null references public.quarterly_cups(id) on delete cascade,
  team_a_id uuid not null references public.quarterly_cup_teams(id),
  team_b_id uuid not null references public.quarterly_cup_teams(id),
  -- Which meeting between this pair this is (1 or 2, since every pair
  -- plays twice by default) — mirrors competition_matches.leg.
  leg integer not null default 1,
  -- The real match row once this game is actually played — same table
  -- every regular club match uses, so ratings update identically. Null
  -- until someone reports the result.
  match_id uuid references public.matches(id) on delete set null,
  winner_team_id uuid references public.quarterly_cup_teams(id),
  created_at timestamptz not null default now()
);

-- Global on/off switch for the nav tab, same pattern as
-- show_competitions_tab — regular members only see it while a Cup is
-- actually running; admins always see it so they can set the next one up.
alter table public.club_settings add column if not exists show_quarterly_cup_tab boolean not null default false;

alter table public.quarterly_cups enable row level security;
alter table public.quarterly_cup_teams enable row level security;
alter table public.quarterly_cup_matches enable row level security;

create policy "quarterly_cups readable by any logged-in member" on public.quarterly_cups for select to authenticated using (true);
create policy "only admins can write quarterly_cups" on public.quarterly_cups for all to authenticated using (is_admin()) with check (is_admin());

create policy "quarterly_cup_teams readable by any logged-in member" on public.quarterly_cup_teams for select to authenticated using (true);
create policy "only admins can write quarterly_cup_teams" on public.quarterly_cup_teams for all to authenticated using (is_admin()) with check (is_admin());

create policy "quarterly_cup_matches readable by any logged-in member" on public.quarterly_cup_matches for select to authenticated using (true);
create policy "only admins can write quarterly_cup_matches" on public.quarterly_cup_matches for all to authenticated using (is_admin()) with check (is_admin());
