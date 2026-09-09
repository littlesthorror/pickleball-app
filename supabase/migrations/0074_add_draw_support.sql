-- Draw/tie support (2026-09-09, Ben's request) — the club plays fixed
-- 9-minute games, not first-to-11/win-by-2, so an equal final score is a
-- real, legitimate result, not a data-entry mistake. A "scores can't be
-- equal" validation briefly lived in the app based on the wrong assumption
-- that pickleball always has a winner; that's been reverted client-side.
--
-- Note the Glicko-2 rating engine (supabase/functions/confirm-match) needs
-- NO changes here — it already computes each team's "actual score" as
-- team_score / (team_a_score + team_b_score), i.e. margin-of-victory, not
-- win/loss. An 8-8 tie already produces actualA = actualB = 0.5, a
-- perfectly symmetric update, exactly as if it had been designed for draws
-- from the start. So no player's rating impact changes as a result of this
-- migration, live or retroactively — this migration is purely about
-- correctly DISPLAYING an already-correct rating outcome, not about
-- correcting one. (Confirmed with Ben this must not cause any sudden
-- rating shift — it doesn't, because there's nothing to recompute.)

-- player_match_history: add an explicit `draw` column alongside the
-- existing `won` (which stays strictly own_score > opponent_score, i.e.
-- false on both a loss AND a draw — callers must check `draw` first to
-- tell the two apart). Purely additive via CREATE OR REPLACE VIEW — `draw`
-- has to be appended at the very end of the column list rather than next
-- to `won`, since CREATE OR REPLACE VIEW can only add columns at the end,
-- not reorder/insert mid-list (Postgres 42P16).
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
  (CASE WHEN mpr.team = 'a' THEN m.team_b_score ELSE m.team_a_score END) AS draw
FROM match_participant_ratings mpr
JOIN matches m ON m.id = mpr.match_id
JOIN player_ratings pr ON pr.player_id = mpr.player_id
WHERE m.status = 'confirmed'::match_status AND (pr.reset_at IS NULL OR m.played_at > pr.reset_at);

-- CREATE OR REPLACE VIEW does NOT preserve reloptions (view options) that
-- aren't repeated in the same statement — migrations 0017/0069 had set
-- security_invoker=true on this view, and the replace above silently reset
-- it back to the default (security definer) since that option wasn't
-- respecified here. Caught immediately via get_advisors right after first
-- applying this migration live; restoring it explicitly so it isn't lost.
ALTER VIEW public.player_match_history SET (security_invoker = true);

-- Competitions: off by default — "Typically, Competitions will also
-- require a win/lose situation. I think 99 times out of 100 a draw won't
-- be required" (Ben). Admin can turn it on per-competition at creation;
-- knockout matches always require a decisive score regardless (enforced
-- client-side, not here, since the group/knockout distinction lives on
-- competition_matches.knockout_round, not on the competition itself).
alter table public.competitions add column if not exists allow_draws boolean not null default false;

-- The Quarterly Cup: off by default, same as Competitions (Ben's follow-up,
-- 2026-09-09 — flip it on per-Cup if a given one should allow draws).
alter table public.quarterly_cups add column if not exists allow_draws boolean not null default false;
