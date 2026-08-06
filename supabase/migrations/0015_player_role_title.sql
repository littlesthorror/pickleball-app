-- Optional, admin-set honorary title (e.g. "Club Coach", "Club Secretary")
-- shown next to a player's name — purely a display label, no bearing on
-- actual permissions (those stay controlled by is_admin).
alter table public.players add column role_title text;

-- create or replace view can only append new columns at the end of the
-- select list, not insert them in the middle, hence role_title being last
-- here rather than sitting next to the other profile fields.
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
  (pr.games_played < 12) as is_provisional,
  p.role_title
from public.players p
join public.player_ratings pr on pr.player_id = p.id;
