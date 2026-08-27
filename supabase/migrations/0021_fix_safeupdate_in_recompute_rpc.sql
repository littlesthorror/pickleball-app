-- pg-safeupdate (enabled by default on Supabase) blocks any DELETE/UPDATE
-- with no WHERE clause, including this intentional full-table wipe inside
-- a security definer function. "where true" preserves the exact same
-- behavior (delete every row) while satisfying the safety check.
create or replace function public.apply_recompute_results(
  rating_rows jsonb,
  participant_rows jsonb,
  match_update_rows jsonb
)
returns void
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
      updated_at = now()
  from jsonb_array_elements(rating_rows) as r
  where pr.player_id = (r->>'player_id')::uuid;

  -- Every match_participant_ratings row only ever exists because of a
  -- confirmed match, and this call is always given a complete fresh set
  -- for every currently-confirmed match — so a full wipe-and-reinsert
  -- (rather than trying to diff old vs new rows) is both simpler and
  -- guaranteed correct. "where true" satisfies pg-safeupdate's
  -- WHERE-clause requirement without changing behavior.
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

revoke execute on function public.apply_recompute_results(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_recompute_results(jsonb, jsonb, jsonb) to service_role;
