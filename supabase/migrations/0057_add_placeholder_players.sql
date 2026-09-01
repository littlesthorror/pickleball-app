-- Admin-created "placeholder"/dummy players (2026-09-01) — for members who
-- are reluctant to sign up themselves but still need to be registered in
-- matches/competitions run through the app. Each one still needs a real
-- (but permanently banned, never-logged-into) auth.users row, since
-- players.id is a foreign key into auth.users — see
-- supabase/functions/create-placeholder-player for how that row is
-- created. This column just distinguishes them from real self-signed-up
-- members for display purposes (a small "Guest" tag in the UI).
alter table public.players
  add column is_placeholder boolean not null default false;

comment on column public.players.is_placeholder is
  'True for admin-created dummy accounts (members who haven''t signed up themselves) — the underlying auth.users row exists but is permanently banned so it can never actually be logged into. See create-placeholder-player edge function.';

-- Recreate player_status to expose the new column — same security_invoker
-- view as before (0055_player_status_security_invoker.sql), just with one
-- more passthrough column.
create or replace view public.player_status
  with (security_invoker = true) as
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
  pr.volatility,
  p.is_placeholder
from public.players p
join public.player_ratings pr on pr.player_id = p.id;
