-- Competitions feature (2026-08-26) — fixed-team doubles, group stage
-- (round robin within small groups of 4-8 teams) followed by a knockout
-- bracket, World-Cup style. Every competition game is ALSO a real row in
-- the existing `matches` table (via competition_matches.match_id), so it
-- flows through the exact same confirm-match / Glicko-2 pipeline as any
-- normal club match — no separate rating engine needed. Group/knockout
-- standings are tracked with plain win/loss/points-difference, the same
-- way football group tables work, not by rating.

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  -- 'setup' (still adding teams/groups) -> 'groups' (group stage live) ->
  -- 'knockout' (bracket live) -> 'completed' (medals recorded).
  status text not null default 'setup' check (status in ('setup', 'groups', 'knockout', 'completed')),
  advance_per_group integer not null default 2,
  created_by uuid references public.players(id),
  created_at timestamptz not null default now()
);

create table public.competition_teams (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  team_name text,
  player1_id uuid not null references public.players(id),
  player2_id uuid not null references public.players(id),
  created_at timestamptz not null default now(),
  check (player1_id <> player2_id)
);

create table public.competition_groups (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.competition_group_teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.competition_groups(id) on delete cascade,
  team_id uuid not null references public.competition_teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A team belongs to exactly one group.
  unique (team_id)
);

create table public.competition_matches (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  -- Null once a match is in the knockout stage.
  group_id uuid references public.competition_groups(id) on delete cascade,
  -- Null during the group stage. 'quarterfinal' | 'semifinal' | 'third_place' | 'final'.
  knockout_round text,
  -- Position within the round — lets the bracket UI know which two
  -- knockout_round matches feed into which next-round match.
  knockout_slot integer,
  team_a_id uuid not null references public.competition_teams(id),
  team_b_id uuid not null references public.competition_teams(id),
  -- The real match row once this game is actually played — same table
  -- every regular club match uses, so ratings update identically.
  match_id uuid references public.matches(id) on delete set null,
  winner_team_id uuid references public.competition_teams(id),
  created_at timestamptz not null default now()
);

-- Final placements, snapshotted once a competition is marked completed —
-- this is what the Club Stats "past competitions" section reads, so it
-- keeps showing correct medal history even if bracket data is ever
-- cleaned up later.
create table public.competition_results (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  team_id uuid not null references public.competition_teams(id),
  placement integer not null,
  created_at timestamptz not null default now(),
  unique (competition_id, placement)
);

-- Global on/off switch for the Competitions nav tab (regular members only
-- — admins always see it so they can set the next one up ahead of time).
-- Added specifically so the extra tab doesn't clutter navigation between
-- events, per Ben's request 2026-08-26.
alter table public.club_settings add column if not exists show_competitions_tab boolean not null default false;

alter table public.competitions enable row level security;
alter table public.competition_teams enable row level security;
alter table public.competition_groups enable row level security;
alter table public.competition_group_teams enable row level security;
alter table public.competition_matches enable row level security;
alter table public.competition_results enable row level security;

-- Same read/write pattern as events and notices: any signed-in member can
-- read, only admins can write.
create policy "competitions readable by any logged-in member" on public.competitions for select to authenticated using (true);
create policy "only admins can write competitions" on public.competitions for all to authenticated using (is_admin()) with check (is_admin());

create policy "competition_teams readable by any logged-in member" on public.competition_teams for select to authenticated using (true);
create policy "only admins can write competition_teams" on public.competition_teams for all to authenticated using (is_admin()) with check (is_admin());

create policy "competition_groups readable by any logged-in member" on public.competition_groups for select to authenticated using (true);
create policy "only admins can write competition_groups" on public.competition_groups for all to authenticated using (is_admin()) with check (is_admin());

create policy "competition_group_teams readable by any logged-in member" on public.competition_group_teams for select to authenticated using (true);
create policy "only admins can write competition_group_teams" on public.competition_group_teams for all to authenticated using (is_admin()) with check (is_admin());

create policy "competition_matches readable by any logged-in member" on public.competition_matches for select to authenticated using (true);
create policy "only admins can write competition_matches" on public.competition_matches for all to authenticated using (is_admin()) with check (is_admin());

create policy "competition_results readable by any logged-in member" on public.competition_results for select to authenticated using (true);
create policy "only admins can write competition_results" on public.competition_results for all to authenticated using (is_admin()) with check (is_admin());
