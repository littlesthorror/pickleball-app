-- Confirms the "established" threshold at 12 games (was an 8-10 game
-- placeholder guess in 0001) — resolved via the old spreadsheet's Elo
-- Debug tab on 2026-08-04.
drop view if exists public.player_status;

create view public.player_status as
select
  p.id,
  p.display_name,
  p.date_joined,
  pr.rating,
  pr.rd,
  pr.games_played,
  (pr.games_played < 12) as is_provisional
from public.players p
join public.player_ratings pr on pr.player_id = p.id;
