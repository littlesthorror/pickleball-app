import type { Badge } from "./badges";
import type { Season } from "./seasons";
import type { PlayerMatchHistoryRow } from "../types";
import type { SeasonWrappedStats } from "./seasonWrappedImage";

// Data-crunching side of the Season Wrapped card (2026-08-28) — kept
// separate from seasonWrappedImage.ts (the canvas drawing) so the "what
// counts as this season's stats" logic can be unit-tested and reasoned
// about on its own, same split as shareCardImage.ts vs the stats Dashboard
// already computes for the regular share card.
//
// Unlike the lifetime "Best partner" shown elsewhere, and unlike the
// lifetime badge list, both are re-derived here scoped to just this one
// season's date window — a player's all-time best partner might not be who
// they played with most that particular season, and a badge earned back in
// Spring shouldn't show up on a Winter wrapped card.

interface SeasonEntryLike {
  games: number;
  wins: number;
  rank: number;
  ratingGain: number;
  // Rating as of the end of this season (Dashboard's SeasonHistoryEntry
  // calls this `rating` — kept as a separate param name here to make clear
  // it's specifically the end-of-season figure, not a live current rating).
  endRating: number;
}

export function computeSeasonWrappedStats(
  season: Season,
  entry: SeasonEntryLike,
  history: PlayerMatchHistoryRow[],
  allBadges: Badge[]
): SeasonWrappedStats {
  const seasonStartMs = season.start.getTime();
  const seasonEndMs = season.nextStart.getTime();

  const inSeason = history.filter((h) => {
    const t = new Date(h.played_at).getTime();
    return t >= seasonStartMs && t < seasonEndMs;
  });

  const winsByPartner = new Map<string, number>();
  for (const h of inSeason) {
    if (h.won) winsByPartner.set(h.teammate_name, (winsByPartner.get(h.teammate_name) ?? 0) + 1);
  }
  let bestPartner: { name: string; wins: number } | null = null;
  for (const [name, wins] of winsByPartner) {
    if (!bestPartner || wins > bestPartner.wins) bestPartner = { name, wins };
  }

  const badgesEarned = allBadges
    .filter((b) => {
      if (!b.achievedAt) return false;
      const t = new Date(b.achievedAt).getTime();
      return t >= seasonStartMs && t < seasonEndMs;
    })
    .sort((a, b) => new Date(b.achievedAt!).getTime() - new Date(a.achievedAt!).getTime());

  return {
    seasonName: season.name,
    seasonLabel: season.label,
    games: entry.games,
    wins: entry.wins,
    winPct: entry.games > 0 ? Math.round((entry.wins / entry.games) * 100) : 0,
    startRating: entry.endRating - entry.ratingGain,
    endRating: entry.endRating,
    ratingGain: entry.ratingGain,
    rank: entry.rank,
    bestPartner,
    badgesEarned,
  };
}
