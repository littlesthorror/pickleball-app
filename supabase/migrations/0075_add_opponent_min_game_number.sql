-- Adds opponent_min_game_number to player_match_history — the LOWER of
-- both opponents' own sequential game counts as of this specific match
-- (mirrors game_number/teammate_game_number's row_number()-style logic,
-- just computed for both opponents via a correlated subquery, same pattern
-- already used for teammate_pre_rating/opponent_min_pre_rating). Needed for
-- Bracket Buster's new games-played floor (2026-09-09, Ben's request: "both
-- pairs have to have registered at least 25 games") — badges.ts already
-- has game_number (you) and teammate_game_number (your partner), but
-- nothing for the opponents' own experience level until now.
--
-- Purely additive — appends one new column to the existing view via
-- CREATE OR REPLACE VIEW, leaving every other column untouched. `draw`
-- (added in 0074) stays as the last column before this one, since CREATE
-- OR REPLACE VIEW can only append columns at the end, not insert mid-list.

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
  END AS teammate_game_number,
  (CASE WHEN mpr.team = 'a' THEN m.team_a_score ELSE m.team_b_score END) =
  (CASE WHEN mpr.team = 'a' THEN m.team_b_score ELSE m.team_a_score END) AS draw,
  CASE
    WHEN mpr.team = 'a' THEN (
      SELECT LEAST(
        (SELECT count(*) FROM match_participant_ratings mpr_o1g JOIN matches m_o1g ON m_o1g.id = mpr_o1g.match_id
          WHERE mpr_o1g.player_id = m.team_b_player_1_id AND m_o1g.status = 'confirmed' AND m_o1g.played_at <= m.played_at),
        (SELECT count(*) FROM match_participant_ratings mpr_o2g JOIN matches m_o2g ON m_o2g.id = mpr_o2g.match_id
          WHERE mpr_o2g.player_id = m.team_b_player_2_id AND m_o2g.status = 'confirmed' AND m_o2g.played_at <= m.played_at)
      )
    )
    ELSE (
      SELECT LEAST(
        (SELECT count(*) FROM match_participant_ratings mpr_o1g JOIN matches m_o1g ON m_o1g.id = mpr_o1g.match_id
          WHERE mpr_o1g.player_id = m.team_a_player_1_id AND m_o1g.status = 'confirmed' AND m_o1g.played_at <= m.played_at),
        (SELECT count(*) FROM match_participant_ratings mpr_o2g JOIN matches m_o2g ON m_o2g.id = mpr_o2g.match_id
          WHERE mpr_o2g.player_id = m.team_a_player_2_id AND m_o2g.status = 'confirmed' AND m_o2g.played_at <= m.played_at)
      )
    )
  END AS opponent_min_game_number
FROM match_participant_ratings mpr
JOIN matches m ON m.id = mpr.match_id
JOIN player_ratings pr ON pr.player_id = mpr.player_id
WHERE m.status = 'confirmed'::match_status AND (pr.reset_at IS NULL OR m.played_at > pr.reset_at);

-- CREATE OR REPLACE VIEW resets reloptions if they aren't repeated in the
-- same statement (see 0074's comment on the exact same gotcha) — restore
-- security_invoker=true every time this view gets replaced.
ALTER VIEW public.player_match_history SET (security_invoker = true);
