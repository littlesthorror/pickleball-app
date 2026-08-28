-- player_status explicitly lists columns rather than using p.* , so the
-- new My Account columns added in 0044 (emergency contact, dark mode,
-- granular push prefs) were invisible everywhere the app reads player data
-- through this view (Dashboard/App.tsx/AdminManagement/Leaderboard etc.)
-- despite existing on the underlying players table. Recreating the view to
-- include them — caught immediately after adding the columns, before any
-- of this shipped, by checking the view definition.
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
  p.notify_rank_change
from players p
join player_ratings pr on pr.player_id = p.id;
