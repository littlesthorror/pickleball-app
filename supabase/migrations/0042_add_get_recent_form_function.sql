-- Leaderboard "form guide" (2026-08-28) — a compact W/L strip of each
-- player's last N confirmed results, without a per-row client-side query
-- per player. Window-function based rather than N+1 queries or fetching
-- full history client-side and slicing, so it stays cheap regardless of
-- how many games a long-tenured player has racked up.
create or replace function public.get_recent_form(p_limit int default 5)
returns table(player_id uuid, results boolean[])
language sql
stable
as $$
  select ranked.player_id, array_agg(ranked.won order by ranked.played_at desc) as results
  from (
    select
      pmh.player_id,
      pmh.played_at,
      pmh.won,
      row_number() over (partition by pmh.player_id order by pmh.played_at desc) as rn
    from public.player_match_history pmh
  ) ranked
  where ranked.rn <= p_limit
  group by ranked.player_id;
$$;

comment on function public.get_recent_form(int) is
  'Returns each player''s last p_limit confirmed match results (most recent first) as a boolean array, for the Leaderboard form guide strip. Added 2026-08-28.';
