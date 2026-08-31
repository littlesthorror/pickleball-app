-- Locks down medical info + emergency contact fields to "the player
-- themselves, or an admin" at the database level, closing a real gap:
-- until now these lived as plain columns on `players`, which has a
-- SELECT policy of "any logged-in club member" (needed so Leaderboard/
-- Dashboard/etc. work for everyone) — meaning any member could have read
-- another member's medical info or emergency contact directly via the API
-- (e.g. via browser dev tools), even though the app's UI only ever
-- displayed it to admins. Postgres RLS is row-level only (no column-level
-- equivalent), so the fix is moving these three columns into their own
-- table with its own, tighter RLS. Applied live by Ben directly via the
-- Supabase SQL Editor 2026-08-31, at his explicit request ("security is
-- very important") — Claude's sandbox classifier blocked the destructive
-- DROP COLUMN step from running via the Supabase MCP connector, so Ben ran
-- it himself after reviewing the script.

create table public.player_private_info (
  player_id uuid primary key references public.players(id) on delete cascade,
  emergency_contact_name text,
  emergency_contact_phone text,
  medical_info text,
  updated_at timestamptz not null default now()
);

alter table public.player_private_info enable row level security;

create policy "own info or admin can select"
  on public.player_private_info for select
  using (auth.uid() = player_id or is_admin());

create policy "own info or admin can insert"
  on public.player_private_info for insert
  with check (auth.uid() = player_id or is_admin());

create policy "own info or admin can update"
  on public.player_private_info for update
  using (auth.uid() = player_id or is_admin())
  with check (auth.uid() = player_id or is_admin());

-- Carry over any existing data before the columns disappear.
insert into public.player_private_info (player_id, emergency_contact_name, emergency_contact_phone, medical_info)
select id, emergency_contact_name, emergency_contact_phone, medical_info
from public.players
where emergency_contact_name is not null
   or emergency_contact_phone is not null
   or medical_info is not null;

-- Two views need dropping and recreating (not "create or replace") since
-- Postgres won't let a view drop an output column via replace — only add
-- new ones. `leaderboard` depends on `player_status` so it goes first.
drop view public.leaderboard;
drop view public.player_status;

alter table public.players
  drop column emergency_contact_name,
  drop column emergency_contact_phone,
  drop column medical_info;

create view public.player_status with (security_invoker = true) as
select
  p.id,
  p.display_name,
  p.date_joined,
  p.is_admin,
  p.is_active,
  p.avatar_url,
  p.date_of_birth,
  p.date_of_birth_visible,
  p.profile_completed,
  p.profile_visible,
  pr.rating,
  pr.rd,
  pr.games_played,
  pr.reset_at,
  pr.games_played < 12 as is_provisional,
  p.role_title,
  p.dark_mode,
  p.notify_new_events,
  p.notify_new_notices,
  p.notify_badge_earned,
  p.notify_rank_change,
  pr.volatility
from players p
join player_ratings pr on pr.player_id = p.id;

create view public.leaderboard with (security_invoker = true) as
select
  id,
  display_name,
  date_joined,
  is_admin,
  is_active,
  avatar_url,
  date_of_birth,
  date_of_birth_visible,
  profile_completed,
  profile_visible,
  rating,
  rd,
  games_played,
  reset_at,
  is_provisional,
  rating - player_rating_as_of(id, now() - interval '30 days') as delta_30d
from player_status ps;

grant select, insert, update, delete, truncate, references, trigger
  on public.player_status, public.leaderboard
  to anon, authenticated, service_role;

grant select, insert, update, delete, truncate, references, trigger
  on public.player_private_info
  to anon, authenticated, service_role;
