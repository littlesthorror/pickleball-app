-- Backs the full-history "recompute ratings" replay (see
-- supabase/functions/recompute-ratings/replay.ts) with a single atomic
-- write instead of several independent client calls. Added 2026-08-10
-- after identifying that a partial failure partway through the previous
-- multi-call write sequence (e.g. one of several `matches` row updates
-- failing on a transient network blip) could leave player_ratings
-- already overwritten while match_participant_ratings was deleted but
-- never re-inserted — recoverable by re-running the recompute, but not a
-- clean guarantee. A single PL/pgSQL function body runs as one implicit
-- transaction: if any statement inside raises, everything in this call
-- rolls back together, so there is no possible partial state anymore.
--
-- The Glicko-2 math and the chronological replay logic (including
-- respecting each player's reset_at "soft reset" point) stay in
-- TypeScript in replay.ts, already validated against live data — this
-- function only receives the final computed rows and applies them.
--
-- Deliberately NOT exposed to anon/authenticated below: this function
-- does no admin check of its own (that already happened in the calling
-- edge function before it decided to call this). Supabase grants EXECUTE
-- on new functions to anon/authenticated by default, so those grants are
-- explicitly revoked and only service_role (used exclusively by trusted
-- edge functions, never the browser) keeps access.
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
      updated_at = now()
  from jsonb_array_elements(rating_rows) as r
  where pr.player_id = (r->>'player_id')::uuid;

  -- Every match_participant_ratings row only ever exists because of a
  -- confirmed match, and this call is always given a complete fresh set
  -- for every currently-confirmed match — so a full wipe-and-reinsert
  -- (rather than trying to diff old vs new rows) is both simpler and
  -- guaranteed correct.
  delete from match_participant_ratings;

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
