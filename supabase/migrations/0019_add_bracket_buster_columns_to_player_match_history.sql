-- Extends player_match_history with two columns needed for the "Bracket
-- Buster" badge (2026-08-11): beating a team where BOTH opponents were
-- individually rated higher than BOTH teammates going into the match.
-- The view previously only exposed the current player's own pre_rating —
-- nothing about the other three players in the match. These two new
-- columns are added at the end (existing columns/order untouched, so
-- this is a purely additive, backward-compatible change):
--   teammate_pre_rating     — your partner's individual pre-game rating
--   opponent_min_pre_rating — the LOWER of the two opponents' individual
--                             pre-game ratings (all that's needed to check
--                             "both opponents outrated both of us": compare
--                             against the higher of {own, teammate}).
create or replace view public.player_match_history as
select
    mpr.player_id,
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
    (case when mpr.team = 'a' then m.team_a_score else m.team_b_score end)
      > (case when mpr.team = 'a' then m.team_b_score else m.team_a_score end) as won,
    case
      when mpr.team = 'a' then (
        select players.display_name from players
        where players.id = case when m.team_a_player_1_id = mpr.player_id then m.team_a_player_2_id else m.team_a_player_1_id end
      )
      else (
        select players.display_name from players
        where players.id = case when m.team_b_player_1_id = mpr.player_id then m.team_b_player_2_id else m.team_b_player_1_id end
      )
    end as teammate_name,
    case
      when mpr.team = 'a' then (
        select string_agg(players.display_name, ' / ') from players
        where players.id = any (array[m.team_b_player_1_id, m.team_b_player_2_id])
      )
      else (
        select string_agg(players.display_name, ' / ') from players
        where players.id = any (array[m.team_a_player_1_id, m.team_a_player_2_id])
      )
    end as opponent_names,
    row_number() over (partition by mpr.player_id order by m.played_at) as game_number,
    case
      when mpr.team = 'a' then (
        select mpr_partner.pre_rating from match_participant_ratings mpr_partner
        where mpr_partner.match_id = m.id
          and mpr_partner.player_id = case when m.team_a_player_1_id = mpr.player_id then m.team_a_player_2_id else m.team_a_player_1_id end
      )
      else (
        select mpr_partner.pre_rating from match_participant_ratings mpr_partner
        where mpr_partner.match_id = m.id
          and mpr_partner.player_id = case when m.team_b_player_1_id = mpr.player_id then m.team_b_player_2_id else m.team_b_player_1_id end
      )
    end as teammate_pre_rating,
    case
      when mpr.team = 'a' then (
        select least(mpr_o1.pre_rating, mpr_o2.pre_rating)
        from match_participant_ratings mpr_o1, match_participant_ratings mpr_o2
        where mpr_o1.match_id = m.id and mpr_o1.player_id = m.team_b_player_1_id
          and mpr_o2.match_id = m.id and mpr_o2.player_id = m.team_b_player_2_id
      )
      else (
        select least(mpr_o1.pre_rating, mpr_o2.pre_rating)
        from match_participant_ratings mpr_o1, match_participant_ratings mpr_o2
        where mpr_o1.match_id = m.id and mpr_o1.player_id = m.team_a_player_1_id
          and mpr_o2.match_id = m.id and mpr_o2.player_id = m.team_a_player_2_id
      )
    end as opponent_min_pre_rating
from match_participant_ratings mpr
join matches m on m.id = mpr.match_id
join player_ratings pr on pr.player_id = mpr.player_id
where m.status = 'confirmed'::match_status and (pr.reset_at is null or m.played_at > pr.reset_at);

-- CREATE OR REPLACE VIEW can silently drop previously-set storage
-- options, so this is restated explicitly rather than assumed to survive
-- the replace.
alter view public.player_match_history set (security_invoker = true);
