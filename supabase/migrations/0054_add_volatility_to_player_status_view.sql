-- Adds pr.volatility to player_status — needed by the new client-side
-- "Impact preview" on Match Entry (2026-08-29, at Ben's request, inspired
-- by DUPR's Impact tool): predicting a hypothetical score's rating swing
-- with the exact same Glicko-2 math confirm-match uses requires each
-- player's volatility, not just rating/rd. See src/lib/impact.ts and
-- src/lib/glicko2.ts (a client-side mirror of
-- supabase/functions/confirm-match/glicko2.ts's pure updateRating(), same
-- pattern predict.ts already uses for the win-probability preview).
--
-- New column appended at the END of the select list — Postgres's
-- `create or replace view` maps existing columns by position, so inserting
-- a new one in the middle errors with "cannot change name of view column"
-- (learned live applying this migration).
create or replace view public.player_status as
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
  p.emergency_contact_name,
  p.emergency_contact_phone,
  p.dark_mode,
  p.notify_new_events,
  p.notify_new_notices,
  p.notify_badge_earned,
  p.notify_rank_change,
  p.medical_info,
  pr.volatility
from players p
join player_ratings pr on pr.player_id = p.id;
