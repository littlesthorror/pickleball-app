// Smart matchmaking (2026-09-04, Ben's idea) — given who's present tonight,
// suggests balanced 2v2 courts round by round for the whole session, using
// the same win-probability math as the Match Predictor and Match Entry's
// Impact preview (src/lib/predict.ts). Nothing here is saved to the
// database — it's a planning tool for the admin running the night, who
// still enters real scores through Match Entry as normal.
//
// A "round" is one pass where every present player either plays one game
// (on one of however many courts fit) or sits out. Per Ben: a typical
// 90-minute session gets each player up to ~7 games, a 60-minute session
// around 5 — see the ROUND_PRESETS export used by the session-length picker
// in Matchmaking.tsx.

import { averageTeam, predictedWinProbability } from "./predict";
import type { PlayerStatus } from "../types";

export interface CourtMatchup {
  teamA: [PlayerStatus, PlayerStatus];
  teamB: [PlayerStatus, PlayerStatus];
  teamAProbability: number;
}

export interface RoundPlan {
  courts: CourtMatchup[];
  sittingOut: PlayerStatus[];
}

export const ROUND_PRESETS = { sixty: 5, ninety: 7 } as const;

// How close two possible team-splits' win probabilities need to be (as a
// fraction, e.g. 0.05 = 5 percentage points) before we stop treating the
// slightly-more-balanced one as strictly better and instead prefer whichever
// pairs two people who haven't partnered as much yet this session. Keeps
// "balanced" from always producing the exact same pairing for a given group
// of 4 across every round.
const BALANCE_TOLERANCE = 0.05;

function pairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join("|");
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Of the 3 ways to split 4 players into two 2v2 teams, picks whichever is
// closest to a 50/50 predicted result — falling back to partner variety
// among any splits that are within BALANCE_TOLERANCE of the best one, so a
// group that comes up more than once across a session's rounds doesn't
// always get split the identical way.
function bestSplit(four: PlayerStatus[], partnerCounts: Map<string, number>): CourtMatchup {
  const [w, x, y, z] = four;
  const combos: [PlayerStatus, PlayerStatus, PlayerStatus, PlayerStatus][] = [
    [w, z, x, y],
    [w, y, x, z],
    [w, x, y, z],
  ];

  const scored = combos.map(([a1, a2, b1, b2]) => {
    const prob = predictedWinProbability(averageTeam(a1, a2), averageTeam(b1, b2));
    const balance = Math.abs(0.5 - prob);
    const repeats =
      (partnerCounts.get(pairKey(a1.id, a2.id)) ?? 0) + (partnerCounts.get(pairKey(b1.id, b2.id)) ?? 0);
    return { a1, a2, b1, b2, prob, balance, repeats };
  });

  const bestBalance = Math.min(...scored.map((s) => s.balance));
  const contenders = scored
    .filter((s) => s.balance <= bestBalance + BALANCE_TOLERANCE)
    .sort((a, b) => a.repeats - b.repeats);
  const winner = contenders[0];

  return { teamA: [winner.a1, winner.a2], teamB: [winner.b1, winner.b2], teamAProbability: winner.prob };
}

/**
 * Plans `numRounds` rounds of balanced 2v2 courts for the given present
 * players. Fairness (who sits out) and partner variety are both tracked
 * only across THIS plan — it has no memory of previous sessions, same as
 * the Match Predictor.
 */
export function planRounds(presentPlayers: PlayerStatus[], numRounds: number): RoundPlan[] {
  const courtsCount = Math.floor(presentPlayers.length / 4);
  if (courtsCount < 1) return [];
  const benchSize = presentPlayers.length - courtsCount * 4;

  const gamesPlayed = new Map(presentPlayers.map((p) => [p.id, 0]));
  const partnerCounts = new Map<string, number>();
  const rounds: RoundPlan[] = [];

  for (let r = 0; r < numRounds; r++) {
    // Whoever's played the fewest games so far sits out least — ties
    // (e.g. round 1, everyone at 0) broken by a fresh shuffle each round
    // rather than always benching the same people first.
    const byFairness = shuffle(presentPlayers).sort(
      (a, b) => (gamesPlayed.get(a.id) ?? 0) - (gamesPlayed.get(b.id) ?? 0)
    );
    const sittingOut = byFairness.slice(0, benchSize);
    const playing = byFairness.slice(benchSize);

    // Tiered-random grouping: split the players actually on court into 4
    // rating tiers (strongest quarter, next quarter, etc.), shuffle within
    // each tier, then take one player from each tier per court. That keeps
    // every court a comparable overall standard (no court stacked with all
    // the strongest players while another gets all the weakest) while still
    // varying exactly who lands where each time this is (re)generated.
    const byRating = [...playing].sort((a, b) => b.rating - a.rating);
    const tiers: PlayerStatus[][] = [];
    for (let t = 0; t < 4; t++) {
      tiers.push(shuffle(byRating.slice(t * courtsCount, (t + 1) * courtsCount)));
    }

    const courts: CourtMatchup[] = [];
    for (let c = 0; c < courtsCount; c++) {
      const four = [tiers[0][c], tiers[1][c], tiers[2][c], tiers[3][c]];
      const matchup = bestSplit(four, partnerCounts);
      courts.push(matchup);

      const keyA = pairKey(matchup.teamA[0].id, matchup.teamA[1].id);
      const keyB = pairKey(matchup.teamB[0].id, matchup.teamB[1].id);
      partnerCounts.set(keyA, (partnerCounts.get(keyA) ?? 0) + 1);
      partnerCounts.set(keyB, (partnerCounts.get(keyB) ?? 0) + 1);
      for (const p of four) gamesPlayed.set(p.id, (gamesPlayed.get(p.id) ?? 0) + 1);
    }

    rounds.push({ courts, sittingOut });
  }

  return rounds;
}
