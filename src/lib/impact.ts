// "Impact preview" for Match Entry — added 2026-08-29 at Ben's request,
// inspired by DUPR's Impact tool ("see the predicted rating change for any
// matchup and scoreline"). Mirrors confirm-match's team-split and
// margin-of-victory logic exactly (see
// supabase/functions/confirm-match/index.ts) so the number shown here
// before a match is submitted matches what the engine will actually apply,
// using the same reasoning predict.ts documents for the win-probability
// preview: this avoids a network round-trip just to preview a "what if".

import { updateRating, type Glicko2Player } from "./glicko2";

export interface RatingImpact {
  deltaA: number;
  deltaB: number;
}

/**
 * Predicted rating change for each team (already team-averaged — see
 * predict.ts's averageTeam) if `teamAScore`–`teamBScore` were submitted.
 * The same whole-number delta the real match would apply to both
 * teammates on the winning/losing side.
 */
export function predictedRatingImpact(
  teamA: Glicko2Player,
  teamB: Glicko2Player,
  teamAScore: number,
  teamBScore: number
): RatingImpact {
  const totalScore = teamAScore + teamBScore;
  const actualA = totalScore > 0 ? teamAScore / totalScore : 0.5;
  const actualB = 1 - actualA;

  const newTeamA = updateRating(teamA, teamB, actualA);
  const newTeamB = updateRating(teamB, teamA, actualB);

  return {
    deltaA: newTeamA.rating - teamA.rating,
    deltaB: newTeamB.rating - teamB.rating,
  };
}
