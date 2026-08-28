alter table public.players
  add column medical_info text;

comment on column public.players.medical_info is
  'Essential Medical Information (conditions, allergies, current medications) — optional, set by the player themselves in My Account, visible only to admins (see AdminManagement.tsx), same visibility pattern as emergency_contact_name/phone. Added 2026-08-28.';

-- Recreate player_status to include the new column — this view explicitly
-- lists columns rather than select p.*, so a new players column is
-- invisible app-wide until the view is recreated to include it (bit us
-- once before, see 0045_add_account_columns_to_player_status_view.sql).
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
  p.medical_info
from players p
join player_ratings pr on pr.player_id = p.id;
