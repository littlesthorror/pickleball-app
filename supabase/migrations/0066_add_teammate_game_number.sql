-- Adds teammate_game_number to player_match_history — the teammate's OWN
-- chronological game count as of this specific match (i.e. how many
-- confirmed matches THEY had played, including this one, at that point in
-- time). Needed for the "Mentor" badge (2026-09-07, Ben's request): playing
-- alongside 10+ different players who were still provisional (<=12 games)
-- at the time you played with them. Mirrors game_number's own
-- row_number()-style logic, just counted for the teammate instead of the
-- viewing player, via a correlated subquery (same pattern already used for
-- teammate_pre_rating/opponent_min_pre_rating/opponent_combined_pre_rating).
--
-- Purely additive — appends one new column to the existing view via
-- CREATE OR REPLACE VIEW, leaving every other column untouched.

CREATE OR REPLACE VIEW player_match_history AS
SELECT
  mpr.player_id,
  m.id AS match_id,
  m.played_at,
  mpr.team,
  mpr.pre_rating,
  mpr.pre_rd,
  mpr.post_rating,
  mpr.post_rd,
  mpr.post_rating - mpr.pre_rating AS rating_delta,
  CASE WHEN mpr.team = 'a' THEN m.team_a_score ELSE m.team_b_score END AS own_score,
  CASE WHEN mpr.team = 'a' THEN m.team_b_score ELSE m.team_a_score END AS opponent_score,
  (CASE WHEN mpr.team = 'a' THEN m.team_a_score ELSE m.team_b_score END) >
  (CASE WHEN mpr.team = 'a' THEN m.team_b_score ELSE m.team_a_score END) AS won,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT players.display_name FROM players
      WHERE players.id = CASE WHEN m.team_a_player_1_id = mpr.player_id THEN m.team_a_player_2_id ELSE m.team_a_player_1_id END
    )
    ELSE (
      SELECT players.display_name FROM players
      WHERE players.id = CASE WHEN m.team_b_player_1_id = mpr.player_id THEN m.team_b_player_2_id ELSE m.team_b_player_1_id END
    )
  END AS teammate_name,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT string_agg(players.display_name, ' / ') FROM players
      WHERE players.id = ANY (ARRAY[m.team_b_player_1_id, m.team_b_player_2_id])
    )
    ELSE (
      SELECT string_agg(players.display_name, ' / ') FROM players
      WHERE players.id = ANY (ARRAY[m.team_a_player_1_id, m.team_a_player_2_id])
    )
  END AS opponent_names,
  row_number() OVER (PARTITION BY mpr.player_id ORDER BY m.played_at) AS game_number,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT mpr_partner.pre_rating FROM match_participant_ratings mpr_partner
      WHERE mpr_partner.match_id = m.id
        AND mpr_partner.player_id = CASE WHEN m.team_a_player_1_id = mpr.player_id THEN m.team_a_player_2_id ELSE m.team_a_player_1_id END
    )
    ELSE (
      SELECT mpr_partner.pre_rating FROM match_participant_ratings mpr_partner
      WHERE mpr_partner.match_id = m.id
        AND mpr_partner.player_id = CASE WHEN m.team_b_player_1_id = mpr.player_id THEN m.team_b_player_2_id ELSE m.team_b_player_1_id END
    )
  END AS teammate_pre_rating,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT LEAST(mpr_o1.pre_rating, mpr_o2.pre_rating) FROM match_participant_ratings mpr_o1, match_participant_ratings mpr_o2
      WHERE mpr_o1.match_id = m.id AND mpr_o1.player_id = m.team_b_player_1_id
        AND mpr_o2.match_id = m.id AND mpr_o2.player_id = m.team_b_player_2_id
    )
    ELSE (
      SELECT LEAST(mpr_o1.pre_rating, mpr_o2.pre_rating) FROM match_participant_ratings mpr_o1, match_participant_ratings mpr_o2
      WHERE mpr_o1.match_id = m.id AND mpr_o1.player_id = m.team_a_player_1_id
        AND mpr_o2.match_id = m.id AND mpr_o2.player_id = m.team_a_player_2_id
    )
  END AS opponent_min_pre_rating,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT mpr_o1.pre_rating + mpr_o2.pre_rating FROM match_participant_ratings mpr_o1, match_participant_ratings mpr_o2
      WHERE mpr_o1.match_id = m.id AND mpr_o1.player_id = m.team_b_player_1_id
        AND mpr_o2.match_id = m.id AND mpr_o2.player_id = m.team_b_player_2_id
    )
    ELSE (
      SELECT mpr_o1.pre_rating + mpr_o2.pre_rating FROM match_participant_ratings mpr_o1, match_participant_ratings mpr_o2
      WHERE mpr_o1.match_id = m.id AND mpr_o1.player_id = m.team_a_player_1_id
        AND mpr_o2.match_id = m.id AND mpr_o2.player_id = m.team_a_player_2_id
    )
  END AS opponent_combined_pre_rating,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT count(*) FROM match_participant_ratings mpr_te
      JOIN matches m_te ON m_te.id = mpr_te.match_id
      WHERE mpr_te.player_id = CASE WHEN m.team_a_player_1_id = mpr.player_id THEN m.team_a_player_2_id ELSE m.team_a_player_1_id END
        AND m_te.status = 'confirmed'
        AND m_te.played_at <= m.played_at
    )
    ELSE (
      SELECT count(*) FROM match_participant_ratings mpr_te
      JOIN matches m_te ON m_te.id = mpr_te.match_id
      WHERE mpr_te.player_id = CASE WHEN m.team_b_player_1_id = mpr.player_id THEN m.team_b_player_2_id ELSE m.team_b_player_1_id END
        AND m_te.status = 'confirmed'
        AND m_te.played_at <= m.played_at
    )
  END AS teammate_game_number
FROM match_participant_ratings mpr
JOIN matches m ON m.id = mpr.match_id
JOIN player_ratings pr ON pr.player_id = mpr.player_id
WHERE m.status = 'confirmed'::match_status AND (pr.reset_at IS NULL OR m.played_at > pr.reset_at);
