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
  p.is_placeholder,
  p.hide_own_rating
from public.players p
join public.player_ratings pr on pr.player_id = p.id;
