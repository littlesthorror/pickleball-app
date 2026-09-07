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
//
// Rewritten 2026-09-07 (Ben's request) to use the standard "circle method"
// round-robin scheduling algorithm instead of a naive i<j nested loop.
// The pairs produced are identical either way — every team still plays
// every other team exactly once (twice for a double round robin) — but the
// circle method additionally groups them into "rounds" where NO team plays
// twice in the same round, which the naive order doesn't give you at all
// (it reads like whatever order teams happen to be listed in, which is why
// it looked "sorted alphabetically" and unusable for real scheduling).
// Team 0 stays fixed and the rest rotate one position each round — a
// standard, well-tested construction, not something bespoke. An odd number
// of teams gets a phantom "bye" seat that never produces a fixture, so
// every real team simply sits out once per round in that case.
//
// This round number is what lets a group with fewer courts than
// simultaneous games (e.g. 8 teams naturally wants 4 games at once, but
// Ben's example only had 2 courts per group) still schedule correctly:
// since every match within one no-clash round shares no teams, that round
// can always be safely split into smaller court-sized batches — see
// scheduleFixturesByCourt() below, which does exactly that at display/
// export time from a group's own start_court/court_count settings.
const BYE_SEAT = "__bye__";

function circleMethodRounds(teamIds: string[]): { teamAId: string; teamBId: string; round: number }[] {
  const ids = [...teamIds];
  if (ids.length % 2 !== 0) ids.push(BYE_SEAT);
  const n = ids.length;
  const numRounds = n - 1;
  const half = n / 2;
  const fixed = ids[0];
  const rotating = ids.slice(1);
  const result: { teamAId: string; teamBId: string; round: number }[] = [];
  for (let r = 0; r < numRounds; r++) {
    const roundTeams = [fixed, ...rotating];
    for (let i = 0; i < half; i++) {
      const a = roundTeams[i];
      const b = roundTeams[n - 1 - i];
      if (a !== BYE_SEAT && b !== BYE_SEAT) {
        result.push({ teamAId: a, teamBId: b, round: r + 1 });
      }
    }
    rotating.unshift(rotating.pop()!);
  }
  return result;
}

export function generateGroupFixtures(
  teamIds: string[],
  doubleRoundRobin = false
): { teamAId: string; teamBId: string; leg: number; round: number }[] {
  const leg1 = circleMethodRounds(teamIds);
  // Number of no-clash rounds a single leg takes — n-1 for an even team
  // count, n for an odd one (the extra round is where the "bye" seat
  // rotates through, so it takes one more round to get everyone through
  // the same number of games). Leg 2's rounds continue on from here rather
  // than restarting at 1, so the printed schedule reads as one continuous
  // sequence rather than two schedules both claiming to have a "Round 1".
  const roundsPerLeg = teamIds.length % 2 === 0 ? teamIds.length - 1 : teamIds.length;
  const fixtures = leg1.map((f) => ({ ...f, leg: 1 }));
  if (doubleRoundRobin) {
    for (const f of leg1) {
      fixtures.push({ teamAId: f.teamBId, teamBId: f.teamAId, round: f.round + roundsPerLeg, leg: 2 });
    }
  }
  return fixtures;
}

export interface ScheduledMatch {
  round: number | null;
}

// Takes a group's already-generated fixtures (each carrying the raw
// no-clash `round` from generateGroupFixtures above) and lays them out
// against real court numbers for display/export — purely a derived view,
// nothing here gets stored. Matches sharing a raw round are split into
// consecutive "printed" rounds sized to `courtCount`, so a group with
// fewer courts than its natural round size still gets a clean, valid
// schedule (see the comment on generateGroupFixtures for why that's always
// safe to do — everything within one raw round already shares no teams).
// Matches with no `round` (pre-migration fixtures, or anything not part of
// a scheduled group) are returned unscheduled (printedRound/court both
// null) so callers can fall back to the old flat list for them.
export function scheduleFixturesByCourt<T extends ScheduledMatch>(
  matches: T[],
  startCourt: number,
  courtCount: number
): (T & { printedRound: number | null; court: number | null })[] {
  if (!startCourt || !courtCount || courtCount < 1) {
    return matches.map((m) => ({ ...m, printedRound: null, court: null }));
  }
  const scheduled = matches.filter((m) => m.round != null);
  const unscheduled = matches.filter((m) => m.round == null);

  const byRound = new Map<number, T[]>();
  for (const m of scheduled) {
    const list = byRound.get(m.round as number) ?? [];
    list.push(m);
    byRound.set(m.round as number, list);
  }
  const sortedRounds = [...byRound.keys()].sort((a, b) => a - b);

  const result: (T & { printedRound: number | null; court: number | null })[] = [];
  let printedRound = 1;
  for (const rawRound of sortedRounds) {
    const roundMatches = byRound.get(rawRound)!;
    for (let i = 0; i < roundMatches.length; i += courtCount) {
      const chunk = roundMatches.slice(i, i + courtCount);
      chunk.forEach((m, idx) => {
        result.push({ ...m, printedRound, court: startCourt + idx });
      });
      printedRound++;
    }
  }
  for (const m of unscheduled) {
    result.push({ ...m, printedRound: null, court: null });
  }
  return result;
}
