-- player_status needs to expose is_admin so the frontend can gate the
-- match-entry/admin-management tabs without a second query. Dropped and
-- recreated (not CREATE OR REPLACE) since Postgres won't let you insert a
-- new column into the middle of an existing view's output list.
drop view if exists public.player_status;

create view public.player_status as
select
  p.id,
  p.display_name,
  p.date_joined,
  p.is_admin,
  pr.rating,
  pr.rd,
  pr.games_played,
  (pr.games_played < 12) as is_provisional
from public.players p
join public.player_ratings pr on pr.player_id = p.id;
