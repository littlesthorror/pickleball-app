// Client-side "predicted result" for the match entry screen — this is now
// the SAME formula the rating engine itself uses to decide how many points
// are on the line (the `E()` function in
// supabase/functions/confirm-match/glicko2.ts), just re-derived here so the
// UI doesn't need a network round-trip to preview it. It factors in each
// team's average rating AND rating deviation (uncertainty), not just a flat
// Elo-style expected score — so a confident 1600 beating a shaky 1550 shows
// a different probability than two well-established players at the same
// gap.

const GLICKO2_SCALE = 173.7178;

function g(phi: number) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

export interface TeamRatingInput {
  rating: number;
  rd: number;
  // Added 2026-08-29 alongside the Impact preview (src/lib/impact.ts) —
  // win-probability itself doesn't use volatility, but averageTeam() is
  // shared by both previews, and impact.ts needs a full Glicko2Player
  // shape (rating/rd/volatility) out of it.
  volatility: number;
}

/**
 * Probability that `team` beats `opponent`, using team-average rating/RD
 * for each side (matching how the engine treats 2v2 teams elsewhere).
 */
export function predictedWinProbability(team: TeamRatingInput, opponent: TeamRatingInput): number {
  const mu = (team.rating - 1500) / GLICKO2_SCALE;
  const muOpp = (opponent.rating - 1500) / GLICKO2_SCALE;
  const phiOpp = opponent.rd / GLICKO2_SCALE;
  return 1 / (1 + Math.exp(-g(phiOpp) * (mu - muOpp)));
}

export function averageTeam(a: TeamRatingInput, b: TeamRatingInput): TeamRatingInput {
  return {
    rating: (a.rating + b.rating) / 2,
    rd: (a.rd + b.rd) / 2,
    volatility: (a.volatility + b.volatility) / 2,
  };
}
