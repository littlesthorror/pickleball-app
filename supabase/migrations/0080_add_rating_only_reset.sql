-- Rating-only reset (2026-10-21, Ben's request): restart a player's rating
-- (1500 / RD 350 / volatility 0.06) WITHOUT touching their match history,
-- games_played, or badges. Unlike reset-player's full reset, reset_at stays
-- null so player_match_history keeps showing all their games.
--   rating_reset_at    when the rating was reset (replay treats it as an event)
--   rating_reset_games games_played at that moment; games since then
--                      (games_played - rating_reset_games) drive the
--                      provisional rules (25-pt gain cap, opponent damping).
alter table public.player_ratings
  add column if not exists rating_reset_at timestamptz,
  add column if not exists rating_reset_games int not null default 0;

create or replace function public.apply_recompute_results(
  rating_rows jsonb,
  participant_rows jsonb,
  match_update_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_ratings pr
  set rating = (r->>'rating')::numeric,
      rd = (r->>'rd')::numeric,
      volatility = (r->>'volatility')::numeric,
      games_played = (r->>'games_played')::int,
      rating_reset_games = coalesce((r->>'rating_reset_games')::int, pr.rating_reset_games),
      updated_at = now()
  from jsonb_array_elements(rating_rows) as r
  where pr.player_id = (r->>'player_id')::uuid;

  -- "where true" satisfies pg-safeupdate (see migration 0021).
  delete from match_participant_ratings where true;

  insert into match_participant_ratings (match_id, player_id, team, pre_rating, pre_rd, post_rating, post_rd)
  select
    (p->>'match_id')::uuid,
    (p->>'player_id')::uuid,
    (p->>'team')::text,
    (p->>'pre_rating')::numeric,
    (p->>'pre_rd')::numeric,
    (p->>'post_rating')::numeric,
    (p->>'post_rd')::numeric
  from jsonb_array_elements(participant_rows) as p;

  update matches m
  set team_a_pre_rating = (u->>'team_a_pre_rating')::numeric,
      team_a_pre_rd = (u->>'team_a_pre_rd')::numeric,
      team_b_pre_rating = (u->>'team_b_pre_rating')::numeric,
      team_b_pre_rd = (u->>'team_b_pre_rd')::numeric,
      team_a_post_rating = (u->>'team_a_post_rating')::numeric,
      team_a_post_rd = (u->>'team_a_post_rd')::numeric,
      team_b_post_rating = (u->>'team_b_post_rating')::numeric,
      team_b_post_rd = (u->>'team_b_post_rd')::numeric
  from jsonb_array_elements(match_update_rows) as u
  where m.id = (u->>'id')::uuid;
end;
$$;

revoke all on function public.apply_recompute_results(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_recompute_results(jsonb, jsonb, jsonb) to service_role;
