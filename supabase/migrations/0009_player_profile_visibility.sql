-- Resolves an open question from the original brief: whether the
-- leaderboard should be opt-in or visible-by-default. Answer: visible by
-- default, with an opt-out per player. Turning it off hides someone from
-- the leaderboard and from other members' ability to view their dashboard
-- — but their matches still count and their own dashboard still works
-- normally, and admins can still see them when entering match results.
alter table public.players add column profile_visible boolean not null default true;

drop view if exists public.leaderboard;
drop view if exists public.player_status;

create view public.player_status as
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
  (pr.games_played < 12) as is_provisional
from public.players p
join public.player_ratings pr on pr.player_id = p.id;

create view public.leaderboard as
select
  ps.*,
  (ps.rating - public.player_rating_as_of(ps.id, now() - interval '30 days')) as delta_30d
from public.player_status ps;
