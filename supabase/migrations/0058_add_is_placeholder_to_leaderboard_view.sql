-- Pass is_placeholder through to the leaderboard view too (0057 added it to
-- player_status but this view lists columns explicitly rather than
-- select *), so Leaderboard.tsx can show a "Guest" tag next to placeholder
-- players. Appended after delta_30d (rather than in "natural" column
-- order) since CREATE OR REPLACE VIEW can only add columns at the end
-- without dropping/recreating the view. Added 2026-09-01.
create or replace view public.leaderboard as
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
  rating - player_rating_as_of(id, now() - interval '30 days') as delta_30d,
  is_placeholder
from player_status ps;
