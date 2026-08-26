// Group-stage standings — plain football-table math (win/loss/points
// difference), not Glicko. A competition's actual games still feed the
// club's real rating engine underneath (see competition_matches.match_id),
// this is purely "who tops the group" for the day.
//
// Points: 2 for a win, 0 for a loss — pickleball games always have a
// winner, there's no draw case to handle. Ties broken by points
// difference, then total points scored, same order most club/regional
// group stages use.

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

export function computeGroupStandings(teamIds: string[], playedMatches: PlayedGroupMatch[]): GroupStandingRow[] {
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
    } else {
      b.won++;
      b.pts += 2;
      a.lost++;
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
// plays every other team in its group exactly once.
export function generateGroupFixtures(teamIds: string[]): { teamAId: string; teamBId: string }[] {
  const fixtures: { teamAId: string; teamBId: string }[] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      fixtures.push({ teamAId: teamIds[i], teamBId: teamIds[j] });
    }
  }
  return fixtures;
}
