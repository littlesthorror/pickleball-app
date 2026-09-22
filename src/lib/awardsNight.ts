import type { Season } from "./seasons";

// Awards Night (2026-09-22, Ben's request — "any new cool features?" ->
// picked from a shortlist including a club-wide end-of-season recap) — a
// single shareable graphic summarising a whole season's standout stats,
// in the same spirit as SeasonWrappedCard (one player's own season) and
// PodiumShareCard (one Quarterly Cup's result), but for the WHOLE club
// across a WHOLE season. Kept as its own file/render pair for the same
// reason those two are split from each other — genuinely different
// content, triggered from a different place (the Leaderboard's season
// card, not a per-player share button or a Cup's standings card).
//
// Deliberately reuses data the season card already has (get_season_
// standings' per-player rows) plus two extra club-wide, season-scoped
// fetches the caller makes on demand when the button is actually
// clicked — not on every page load, since a season's full match history
// can be a few hundred to over a thousand rows and nobody needs that
// fetched just for viewing the standings table.

export interface AwardsNightStandingRow {
  playerId: string;
  rank: number;
  rating: number;
  games: number;
  wins: number;
  ratingGain: number;
}

// Same shape as the "this month" rows ClubStats.tsx/Leaderboard.tsx
// already fetch for Biggest upset — reused here scoped to a season's date
// window instead of a calendar month.
export interface AwardsNightHistoryRow {
  match_id: string;
  won: boolean;
  pre_rating: number;
  own_score: number;
  opponent_score: number;
  teammate_name: string;
  opponent_names: string;
}

// Same shape as the raw match-team rows the "Most active pairing" stats
// use elsewhere — team_a/b_score added here so a pair's WINS together can
// be counted, not just games played together (an "Awards Night" partner
// category is more interesting as "who won the most together" than
// "who happened to be on court together most").
export interface AwardsNightMatchRow {
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  team_a_score: number;
  team_b_score: number;
}

export interface AwardsNightAward {
  emoji: string;
  category: string;
  winner: string;
  detail: string;
}

export interface AwardsNightStats {
  seasonLabel: string;
  final: boolean;
  awards: AwardsNightAward[];
}

// Same "meaningful sample size" bar the Club leaderboard/Club Player
// award already use (MIN_GAMES_FOR_CLUB_PLAYER in Leaderboard.tsx) —
// reused here so "Most Improved" can't be won by someone who played two
// games and got lucky.
const MIN_GAMES_FOR_MOST_IMPROVED = 12;

export function computeAwardsNightStats(
  season: Season,
  final: boolean,
  standings: AwardsNightStandingRow[],
  namesById: Map<string, string>,
  history: AwardsNightHistoryRow[],
  matches: AwardsNightMatchRow[]
): AwardsNightStats | null {
  if (standings.length === 0) return null;

  const nameFor = (id: string) => namesById.get(id) ?? "?";
  const awards: AwardsNightAward[] = [];

  // MVP — whoever topped the season standings.
  const mvp = standings.find((s) => s.rank === 1) ?? standings[0];
  if (mvp) {
    awards.push({
      emoji: "🏆",
      category: "MVP",
      winner: nameFor(mvp.playerId),
      detail: `${Math.round(mvp.rating)} rating · #1`,
    });
  }

  // Most Improved — biggest rating gain, among players with a real sample
  // of games this season (avoids a 2-game player with a lucky run winning
  // over someone who played all season). Only awarded if someone actually
  // gained ground — a "most improved" who lost rating overall would be a
  // strange thing to put on a graphic.
  const improvedCandidates = standings.filter((s) => s.games >= MIN_GAMES_FOR_MOST_IMPROVED && s.ratingGain > 0);
  if (improvedCandidates.length > 0) {
    const mostImproved = improvedCandidates.reduce((a, b) => (b.ratingGain > a.ratingGain ? b : a));
    awards.push({
      emoji: "📈",
      category: "Most Improved",
      winner: nameFor(mostImproved.playerId),
      detail: `+${Math.round(mostImproved.ratingGain)} pts this season`,
    });
  }

  // Most Active — most games played, whoever that is.
  const activeCandidates = standings.filter((s) => s.games > 0);
  if (activeCandidates.length > 0) {
    const mostActive = activeCandidates.reduce((a, b) => (b.games > a.games ? b : a));
    awards.push({
      emoji: "🎾",
      category: "Most Active",
      winner: nameFor(mostActive.playerId),
      detail: `${mostActive.games} games played`,
    });
  }

  // Best Partnership — the doubles pair with the most wins together this
  // season, counted by player id (not name) so two same-named players
  // can't merge, same care Leaderboard/ClubStats's "Most active pairing"
  // already takes. Draws (equal scores) don't count toward either side.
  const pairWins = new Map<string, number>();
  const addPairWin = (a: string, b: string) => {
    const key = [a, b].sort().join("|");
    pairWins.set(key, (pairWins.get(key) ?? 0) + 1);
  };
  for (const m of matches) {
    if (m.team_a_score === m.team_b_score) continue;
    if (m.team_a_score > m.team_b_score) addPairWin(m.team_a_player_1_id, m.team_a_player_2_id);
    else addPairWin(m.team_b_player_1_id, m.team_b_player_2_id);
  }
  let bestPair: { key: string; wins: number } | null = null;
  for (const [key, wins] of pairWins) {
    if (!bestPair || wins > bestPair.wins) bestPair = { key, wins };
  }
  if (bestPair) {
    const [a, b] = bestPair.key.split("|");
    awards.push({
      emoji: "🤝",
      category: "Best Partnership",
      winner: `${nameFor(a)} & ${nameFor(b)}`,
      detail: `${bestPair.wins} win${bestPair.wins === 1 ? "" : "s"} together`,
    });
  }

  // Biggest Upset — the season's confirmed match with the largest average
  // pre-match rating gap where the lower-rated pair still won. Identical
  // logic to ClubStats.tsx's/Leaderboard.tsx's "this month" version, just
  // fed the whole season's rows instead of one calendar month's.
  const byMatch = new Map<string, AwardsNightHistoryRow[]>();
  for (const h of history) {
    const list = byMatch.get(h.match_id) ?? [];
    list.push(h);
    byMatch.set(h.match_id, list);
  }
  let biggestUpset: { winnerNames: string; loserNames: string; gap: number; score: string } | null = null;
  for (const matchRows of byMatch.values()) {
    const winners = matchRows.filter((r) => r.won);
    const losers = matchRows.filter((r) => !r.won);
    if (winners.length === 0 || losers.length === 0) continue;
    const winnerAvgRating = winners.reduce((s, r) => s + r.pre_rating, 0) / winners.length;
    const loserAvgRating = losers.reduce((s, r) => s + r.pre_rating, 0) / losers.length;
    if (loserAvgRating <= winnerAvgRating) continue;
    const gap = loserAvgRating - winnerAvgRating;
    if (!biggestUpset || gap > biggestUpset.gap) {
      const [w0, w1] = winners;
      biggestUpset = {
        winnerNames: w1 ? `${w0.teammate_name} & ${w1.teammate_name}` : w0.teammate_name,
        loserNames: w0.opponent_names,
        gap,
        score: `${w0.own_score}-${w0.opponent_score}`,
      };
    }
  }
  if (biggestUpset) {
    awards.push({
      emoji: "💥",
      category: "Biggest Upset",
      winner: biggestUpset.winnerNames,
      detail: `beat ${biggestUpset.loserNames} by ${Math.round(biggestUpset.gap)} pts (${biggestUpset.score})`,
    });
  }

  if (awards.length === 0) return null;

  return { seasonLabel: season.label, final, awards };
}
