// A simple, games-played-only progression ladder shown as a badge next to
// a player's name on the dashboard. Deliberately NOT tied to rating — it's
// about participation, not skill, so it only ever goes up and nobody's
// tier can go backwards just because they lost a few matches. Replaces the
// old binary "Provisional / Established" badge with more steps to unlock
// as people keep playing.
export interface Tier {
  label: string;
  className: string;
  minGames: number;
}

export const TIERS: Tier[] = [
  { label: "Rookie", className: "badge-tier-rookie", minGames: 0 },
  { label: "Regular", className: "badge-tier-regular", minGames: 50 },
  { label: "Veteran", className: "badge-tier-veteran", minGames: 100 },
  { label: "Legend", className: "badge-tier-legend", minGames: 200 },
  { label: "The Court Marshall", className: "badge-tier-court-marshall", minGames: 500 },
  { label: "The Kitchen Witch", className: "badge-tier-kitchen-witch", minGames: 750 },
  { label: "The Lob Lord", className: "badge-tier-lob-lord", minGames: 1000 },
  { label: "The Sultan of Spin", className: "badge-tier-sultan-of-spin", minGames: 1250 },
  { label: "The Dinktator", className: "badge-tier-dinktator", minGames: 1500 },
];

export function getTier(gamesPlayed: number): Tier {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (gamesPlayed >= tier.minGames) current = tier;
  }
  return current;
}

// Returns the next tier up and how many games are needed to reach it, or
// null if the player's already at the top tier.
export function getNextTier(gamesPlayed: number): { tier: Tier; gamesToGo: number } | null {
  for (const tier of TIERS) {
    if (gamesPlayed < tier.minGames) {
      return { tier, gamesToGo: tier.minGames - gamesPlayed };
    }
  }
  return null;
}
