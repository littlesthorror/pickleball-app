-- Speed up player_match_history (2026-11-25, Ben: "Club Stats appears to be
-- loading slowly"). Measured: ~8.9 s per 1000-row page, and Club Stats pages
-- through ~4,200 rows. The cause: teammate_game_number,
-- opponent_min_game_number and opponent_combined_game_number were each a
-- correlated subquery that re-counted a player's WHOLE history for every row
-- (~600k buffer hits per column), so cost grew with games^2.
--
-- Replaced with a single windowed count (gc CTE: each player's running game
-- count, peer-inclusive so ties at the same played_at match the old
-- `played_at <= m.played_at` semantics) joined in by (match, player).
-- Output columns, names, types and order are UNCHANGED. Verified before
-- applying: 4192 rows in both versions, 0 mismatches on the three columns.

create or replace view public.player_match_history as
with gc as (
  select mpr0.player_id, mpr0.match_id,
         count(*) over (partition by mpr0.player_id order by m0.played_at) as n
  from public.match_participant_ratings mpr0
  join public.matches m0 on m0.id = mpr0.match_id
  where m0.status = 'confirmed'
)
select mpr.player_id,
    m.id as match_id,
    m.played_at,
    mpr.team,
    mpr.pre_rating,
    mpr.pre_rd,
    mpr.post_rating,
    mpr.post_rd,
    mpr.post_rating - mpr.pre_rating as rating_delta,
    case when mpr.team = 'a' then m.team_a_score else m.team_b_score end as own_score,
    case when mpr.team = 'a' then m.team_b_score else m.team_a_score end as opponent_score,
    (case when mpr.team = 'a' then m.team_a_score else m.team_b_score end) >
    (case when mpr.team = 'a' then m.team_b_score else m.team_a_score end) as won,
    case when mpr.team = 'a' then (select players.display_name from players where players.id = case when m.team_a_player_1_id = mpr.player_id then m.team_a_player_2_id else m.team_a_player_1_id end)
         else (select players.display_name from players where players.id = case when m.team_b_player_1_id = mpr.player_id then m.team_b_player_2_id else m.team_b_player_1_id end) end as teammate_name,
    case when mpr.team = 'a' then (select string_agg(players.display_name, ' / ') from players where players.id = any (array[m.team_b_player_1_id, m.team_b_player_2_id]))
         else (select string_agg(players.display_name, ' / ') from players where players.id = any (array[m.team_a_player_1_id, m.team_a_player_2_id])) end as opponent_names,
    row_number() over (partition by mpr.player_id order by m.played_at) as game_number,
    case when mpr.team = 'a' then (select mpr_partner.pre_rating from match_participant_ratings mpr_partner where mpr_partner.match_id = m.id and mpr_partner.player_id = case when m.team_a_player_1_id = mpr.player_id then m.team_a_player_2_id else m.team_a_player_1_id end)
         else (select mpr_partner.pre_rating from match_participant_ratings mpr_partner where mpr_partner.match_id = m.id and mpr_partner.player_id = case when m.team_b_player_1_id = mpr.player_id then m.team_b_player_2_id else m.team_b_player_1_id end) end as teammate_pre_rating,
    case when mpr.team = 'a' then (select least(mpr_o1.pre_rating, mpr_o2.pre_rating) from match_participant_ratings mpr_o1, match_participant_ratings mpr_o2 where mpr_o1.match_id = m.id and mpr_o1.player_id = m.team_b_player_1_id and mpr_o2.match_id = m.id and mpr_o2.player_id = m.team_b_player_2_id)
         else (select least(mpr_o1.pre_rating, mpr_o2.pre_rating) from match_participant_ratings mpr_o1, match_participant_ratings mpr_o2 where mpr_o1.match_id = m.id and mpr_o1.player_id = m.team_a_player_1_id and mpr_o2.match_id = m.id and mpr_o2.player_id = m.team_a_player_2_id) end as opponent_min_pre_rating,
    case when mpr.team = 'a' then (select mpr_o1.pre_rating + mpr_o2.pre_rating from match_participant_ratings mpr_o1, match_participant_ratings mpr_o2 where mpr_o1.match_id = m.id and mpr_o1.player_id = m.team_b_player_1_id and mpr_o2.match_id = m.id and mpr_o2.player_id = m.team_b_player_2_id)
         else (select mpr_o1.pre_rating + mpr_o2.pre_rating from match_participant_ratings mpr_o1, match_participant_ratings mpr_o2 where mpr_o1.match_id = m.id and mpr_o1.player_id = m.team_a_player_1_id and mpr_o2.match_id = m.id and mpr_o2.player_id = m.team_a_player_2_id) end as opponent_combined_pre_rating,
    g_tm.n as teammate_game_number,
    (case when mpr.team = 'a' then m.team_a_score else m.team_b_score end) =
    (case when mpr.team = 'a' then m.team_b_score else m.team_a_score end) as draw,
    least(g_o1.n, g_o2.n) as opponent_min_game_number,
    g_o1.n + g_o2.n as opponent_combined_game_number
from match_participant_ratings mpr
join matches m on m.id = mpr.match_id
join player_ratings pr on pr.player_id = mpr.player_id
left join gc g_tm on g_tm.match_id = m.id and g_tm.player_id = (case when mpr.team = 'a' then (case when m.team_a_player_1_id = mpr.player_id then m.team_a_player_2_id else m.team_a_player_1_id end) else (case when m.team_b_player_1_id = mpr.player_id then m.team_b_player_2_id else m.team_b_player_1_id end) end)
left join gc g_o1 on g_o1.match_id = m.id and g_o1.player_id = (case when mpr.team = 'a' then m.team_b_player_1_id else m.team_a_player_1_id end)
left join gc g_o2 on g_o2.match_id = m.id and g_o2.player_id = (case when mpr.team = 'a' then m.team_b_player_2_id else m.team_a_player_2_id end)
where m.status = 'confirmed' and (pr.reset_at is null or m.played_at > pr.reset_at);
