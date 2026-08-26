// Group-stage standings — plain football-table math (win/loss/points
// difference), not Glicko. A competition's actual games still feed the
// club's real rating engine underneath (see competition_matches.match_id),
// this is purely "who tops the group" for the day.
//
// Two scoring systems, chosen per-competition (see CompetitionRow.scoring_system):
//   "standard" — 2 for a win, 0 for a loss. Pickleball games always have a
//     winner, so there's no draw case to handle.
//   "social" — 2 for a win, and the losing team still picks up 1 point if
//     they scored more than 6 in the game (i.e. it was a competitive game,
//     not a blowout). Added 2026-08-26 at Ben's request.
// Ties broken by points difference, then total points scored, same order
// most club/regional group stages use.

import type { ScoringSystem } from "../types";

const SOCIAL_CONSOLATION_THRESHOLD = 6;

export interface GroupStandingRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  pts: number;
}

export interface PlayedGroupMatch {
  teamAId: string;
  teamBId: string;
  teamAScore: number;
  teamBScore: number;
}

export function computeGroupStandings(
  teamIds: string[],
  playedMatches: PlayedGroupMatch[],
  scoringSystem: ScoringSystem = "standard"
): GroupStandingRow[] {
  const rows = new Map<string, GroupStandingRow>();
  for (const id of teamIds) {
    rows.set(id, { teamId: id, played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, pts: 0 });
  }

  for (const m of playedMatches) {
    const a = rows.get(m.teamAId);
    const b = rows.get(m.teamBId);
    if (!a || !b) continue; // defensive — shouldn't happen, team not in this group

    a.played++;
    b.played++;
    a.pointsFor += m.teamAScore;
    a.pointsAgainst += m.teamBScore;
    b.pointsFor += m.teamBScore;
    b.pointsAgainst += m.teamAScore;

    if (m.teamAScore > m.teamBScore) {
      a.won++;
      a.pts += 2;
      b.lost++;
      if (scoringSystem === "social" && m.teamBScore > SOCIAL_CONSOLATION_THRESHOLD) {
        b.pts += 1;
      }
    } else {
      b.won++;
      b.pts += 2;
      a.lost++;
      if (scoringSystem === "social" && m.teamAScore > SOCIAL_CONSOLATION_THRESHOLD) {
        a.pts += 1;
      }
    }
  }

  for (const row of rows.values()) {
    row.diff = row.pointsFor - row.pointsAgainst;
  }

  return Array.from(rows.values()).sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.diff !== x.diff) return y.diff - x.diff;
    return y.pointsFor - x.pointsFor;
  });
}

// Every unique pairing within a group — a full round robin, each team
// plays every other team in its group once (or twice, for a double round
// robin — see CompetitionRow.double_round_robin). The second leg swaps
// which team is listed first, purely so the two fixtures don't render as
// identical-looking duplicates; it has no effect on scoring. Added
// 2026-08-27 at Ben's request ("we normally have teams play each other
// twice").
export function generateGroupFixtures(
  teamIds: string[],
  doubleRoundRobin = false
): { teamAId: string; teamBId: string; leg: number }[] {
  const fixtures: { teamAId: string; teamBId: string; leg: number }[] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      fixtures.push({ teamAId: teamIds[i], teamBId: teamIds[j], leg: 1 });
      if (doubleRoundRobin) {
        fixtures.push({ teamAId: teamIds[j], teamBId: teamIds[i], leg: 2 });
      }
    }
  }
  return fixtures;
}
