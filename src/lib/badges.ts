import type { PlayerMatchHistoryRow } from "../types";
import type { SeasonName } from "./seasons";

// One row per calendar month this player finished in the club's Top 10 —
// fetched from monthly_leaderboard_snapshots, which is only ever populated
// forward from when that feature shipped (2026-08-14). No backfill for
// earlier months, per Ben's call — every player effectively starts fresh.
export interface MonthlyFinish {
  yearMonth: string; // "YYYY-MM"
  rank: number;
}

// One row per Competitions placement (1st or 2nd) this player's team
// earned — fetched from competition_results, joined through
// competition_teams to find teams this player was on. Added 2026-08-27 at
// Ben's request for "Competition Winner"/"Competition Runner Up" badges.
export interface CompetitionPlacement {
  placement: 1 | 2;
  competitionName: string;
  achievedAt: string;
}

// One row per completed Season this player finished Top 10 in — derived
// client-side from Dashboard.tsx's existing seasonEntries (already fetched
// live via get_season_standings for the Seasons feature), filtered to
// rank <= 10 and to seasons that have actually ended. Added 2026-08-28 at
// Ben's request for "a summer badge, winter badge etc." — one badge per
// season TYPE rather than per instance, same aggregate + most-recent
// pattern as the monthly Top 10/Top 3 badges.
export interface SeasonTop10Finish {
  seasonName: SeasonName;
  label: string; // e.g. "Autumn 2026" — the specific instance's display label
  achievedAt: string; // ISO date the season ended, for "most recent" sorting
}

export interface Badge {
  id: string;
  emoji: string;
  label: string;
  description: string;
  // ISO date string for the game (or moment) that earned this badge — used
  // to sort the Dashboard's badge grid "most recent first". Added
  // 2026-08-13 so the grid can show newest achievements up top rather than
  // a fixed category order.
  achievedAt: string | null;
}

// Deliberately celebratory-only, with one exception ("First time pickled")
// added at Ben's explicit request on 2026-08-05 as a bit of fun clubhouse
// culture rather than a comparison against anyone else — it's about your
// own history, same as everything else here. See the original "no
// gloating" note from 2026-08-04 for why nothing compares one player
// against another.
export function computeBadges(
  history: PlayerMatchHistoryRow[],
  gamesPlayed: number,
  dateJoined: string,
  monthlyFinishes: MonthlyFinish[] = [],
  competitionPlacements: CompetitionPlacement[] = [],
  seasonTop10Finishes: SeasonTop10Finish[] = []
): Badge[] {
  const badges: Badge[] = [];

  const firstWin = history.find((h) => h.won);
  if (firstWin) {
    badges.push({
      id: "first-win",
      emoji: "🎉",
      label: "First win",
      description: `Beat ${firstWin.opponent_names} on your way to your first W.`,
      achievedAt: firstWin.played_at,
    });
  }

  // 1-year anniversary — purely time-based, nothing to do with results.
  if (dateJoined) {
    const joined = new Date(dateJoined);
    const oneYearLater = new Date(joined);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    if (new Date() >= oneYearLater) {
      badges.push({
        id: "one-year",
        emoji: "🎊",
        label: "1 year using Sideline",
        description: `Joined ${joined.toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}.`,
        achievedAt: oneYearLater.toISOString(),
      });
    }
  }

  // History arrives ordered by game_number ascending (see Dashboard.tsx's
  // query), so the Nth entry is the game that crossed the Nth-game
  // milestone — used below for games-played, games-won, and streak dates.
  const gameMilestones = [10, 25, 50, 100, 200, 250, 500];
  for (const milestone of gameMilestones) {
    if (gamesPlayed >= milestone) {
      badges.push({
        id: `games-${milestone}`,
        emoji: milestone >= 100 ? "🏆" : "📈",
        label: `${milestone} games played`,
        description: `Logged ${milestone}+ confirmed matches.`,
        achievedAt: history[milestone - 1]?.played_at ?? null,
      });
    }
  }

  // "Games won" milestones — added 2026-08-11 at Ben's request. Separate
  // from the games-played milestones above: this counts only the Ws, not
  // every confirmed match logged.
  const wonGames = history.filter((h) => h.won);
  const gamesWon = wonGames.length;
  const winMilestones = [
    { games: 50, emoji: "🏅" },
    { games: 100, emoji: "🥇" },
  ];
  for (const milestone of winMilestones) {
    if (gamesWon >= milestone.games) {
      badges.push({
        id: `wins-${milestone.games}`,
        emoji: milestone.emoji,
        label: `${milestone.games} games won`,
        description: `Won ${milestone.games}+ confirmed matches.`,
        achievedAt: wonGames[milestone.games - 1]?.played_at ?? null,
      });
    }
  }

  // "Dream team" — 25+ wins alongside the same partner. Grouped by
  // teammate name (a 2v2 team, not an individual credit split) — same
  // approach as the head-to-head record on the dashboard. Only awarded
  // for whichever partner you've won the most with, so it doesn't fire
  // separately for every partner who happens to clear 25.
  const winsByPartner = new Map<string, number>();
  for (const h of history) {
    if (h.won) winsByPartner.set(h.teammate_name, (winsByPartner.get(h.teammate_name) ?? 0) + 1);
  }
  let bestPartnerWins = 0;
  let bestPartnerName = "";
  for (const [name, wins] of winsByPartner) {
    if (wins > bestPartnerWins) {
      bestPartnerWins = wins;
      bestPartnerName = name;
    }
  }
  const PARTNER_WIN_MILESTONE = 25;
  if (bestPartnerWins >= PARTNER_WIN_MILESTONE) {
    const partnerWins = history.filter((h) => h.won && h.teammate_name === bestPartnerName);
    badges.push({
      id: "partner-25-wins",
      emoji: "🤝",
      label: `${PARTNER_WIN_MILESTONE} wins with a partner`,
      description: `Won ${bestPartnerWins} games alongside ${bestPartnerName}.`,
      achievedAt: partnerWins[PARTNER_WIN_MILESTONE - 1]?.played_at ?? null,
    });
  }

  // Longest winning streak, purely as a personal-best — shown even if it's
  // short (a 2-game streak is still a nice thing to see for a newer
  // player), never framed as a ranking against anyone else.
  //
  // Tiered like the games-played milestones: every threshold reached gets
  // its own badge, with the fire emoji count going up per tier (added
  // 2026-08-10 at Ben's request). The 15-game tier gets its own name and
  // emoji instead of a fourth stacked flame — three flames was already
  // about as far as that joke could go, so at 15 you've earned an actual
  // fire engine (added 2026-08-28 at Ben's request).
  const streakMilestones: { games: number; emoji: string; label?: string; description?: string }[] = [
    { games: 3, emoji: "🔥" },
    { games: 6, emoji: "🔥🔥" },
    { games: 10, emoji: "🔥🔥🔥" },
    {
      games: 15,
      emoji: "🚒",
      label: "On Fire",
      description: "Reached a 15-game winning streak — someone call the fire brigade.",
    },
  ];
  let longestStreak = 0;
  let current = 0;
  // Date each threshold was first reached — the game that made the streak
  // hit that length, not the streak's eventual end.
  const streakReachedAt = new Map<number, string>();
  for (const h of history) {
    if (h.won) {
      current += 1;
      longestStreak = Math.max(longestStreak, current);
      for (const milestone of streakMilestones) {
        if (current === milestone.games && !streakReachedAt.has(milestone.games)) {
          streakReachedAt.set(milestone.games, h.played_at);
        }
      }
    } else {
      current = 0;
    }
  }
  for (const milestone of streakMilestones) {
    if (longestStreak >= milestone.games) {
      badges.push({
        id: `streak-${milestone.games}`,
        emoji: milestone.emoji,
        label: milestone.label ?? `${milestone.games}-game winning streak`,
        description:
          milestone.description ??
          `Reached a ${milestone.games}-game winning streak — your best run so far is ${longestStreak}.`,
        achievedAt: streakReachedAt.get(milestone.games) ?? null,
      });
    }
  }

  // "Standout win" — beating the other team by 15 or more clear points in
  // a single game. Changed 2026-08-10 from a rating-jump-based definition
  // to this simpler, more tangible margin-of-victory one at Ben's request.
  // Only shown once, for the biggest margin.
  const bigWins = history.filter((h) => h.won && h.own_score - h.opponent_score >= 15);
  if (bigWins.length > 0) {
    const biggest = bigWins.reduce((best, h) =>
      h.own_score - h.opponent_score > best.own_score - best.opponent_score ? h : best
    );
    badges.push({
      id: "big-win",
      emoji: "⚡",
      label: "Standout win",
      description: `Beat ${biggest.opponent_names} ${biggest.own_score}–${biggest.opponent_score} — a 15+ point win.`,
      achievedAt: biggest.played_at,
    });
  }

  // "Twenty Pointer" — 20 or more points scored in a single game.
  const twentyPointer = history.find((h) => h.own_score >= 20);
  if (twentyPointer) {
    badges.push({
      id: "twenty-pointer",
      emoji: "🎯",
      label: "Twenty Pointer",
      description: `Scored ${twentyPointer.own_score} points in a single game.`,
      achievedAt: twentyPointer.played_at,
    });
  }

  // "First time pickled" — shut out 0 points in a game. A pickleball rite
  // of passage, not a mark of shame — happens to everyone eventually.
  const pickled = history.find((h) => h.own_score === 0);
  if (pickled) {
    badges.push({
      id: "pickled",
      emoji: "🥒",
      label: "First time pickled",
      description: `Shut out 0–${pickled.opponent_score} — it happens to everyone eventually.`,
      achievedAt: pickled.played_at,
    });
  }

  // ── 6 more badges added 2026-08-11 at Ben's request ────────────────────

  // "Heartbreak" — 3 separate losses by the minimum possible margin
  // (2 points, e.g. 11-9) within any 7-day window. Uses a rolling window
  // over just the qualifying losses (not every game), so the 3 don't need
  // to be back-to-back games, just close together in time.
  const minMarginLosses = history
    .filter((h) => !h.won && h.opponent_score - h.own_score === 2)
    .map((h) => new Date(h.played_at).getTime())
    .sort((a, b) => a - b);
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  for (let i = 0; i + 2 < minMarginLosses.length; i++) {
    if (minMarginLosses[i + 2] - minMarginLosses[i] <= WEEK_MS) {
      const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      badges.push({
        id: "heartbreak",
        emoji: "💔",
        label: "Heartbreak",
        description: `Lost 3 games by just 2 points each, all within one week (${fmt(minMarginLosses[i])}–${fmt(minMarginLosses[i + 2])}).`,
        achievedAt: new Date(minMarginLosses[i + 2]).toISOString(),
      });
      break;
    }
  }

  // "Rollercoaster" — rating swings by more than 200 points within a
  // single calendar month. Measured as the full range (highest minus
  // lowest rating touched) within the month, seeded with the rating you
  // entered the month at — so a big move right at the start of the month
  // still counts, not just swings between games that both fall in-month.
  // This is a range check rather than requiring the swing to specifically
  // go up-then-down (vs. just one big move) — a reasonable simplification
  // given how much "up and down" already tends to happen naturally while
  // RD is still high early on.
  //
  // Threshold raised from 100 to 200 on 2026-09-01 (Ben: "a few people
  // have that already... I think the number needs to be a bit higher") —
  // the club's very first logged session showed 12 of 17 active players
  // over 100 points, since everyone starts at RD 350 (max uncertainty,
  // biggest possible per-game swings) in their very first month. 100 was
  // effectively "played your first session," not a genuinely rare/notable
  // swing. 200 was chosen because it sat just above the natural gap in
  // that session's real numbers (233 and 220 for the two biggest movers,
  // next was 167) — see 0059_grandfather_rollercoaster_badge.sql for the
  // players who'd already earned it under the old rule and were granted a
  // matching legacy_badges row so they don't lose it now that the bar has
  // moved.
  const dateJoinedRating = { date: dateJoined, rating: 1500 };
  const ratingPoints = [dateJoinedRating, ...history.map((h) => ({ date: h.played_at, rating: h.post_rating }))];
  const monthKey = (d: string) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${dt.getMonth()}`;
  };
  const monthSwings = new Map<string, { min: number; max: number; date: Date }>();
  for (let i = 1; i < ratingPoints.length; i++) {
    const key = monthKey(ratingPoints[i].date);
    if (!monthSwings.has(key)) {
      const entryRating = ratingPoints[i - 1].rating;
      monthSwings.set(key, { min: entryRating, max: entryRating, date: new Date(ratingPoints[i].date) });
    }
    const g = monthSwings.get(key)!;
    g.min = Math.min(g.min, ratingPoints[i].rating);
    g.max = Math.max(g.max, ratingPoints[i].rating);
  }
  let biggestSwing = 0;
  let biggestSwingMonth: Date | null = null;
  for (const g of monthSwings.values()) {
    const swing = g.max - g.min;
    if (swing > biggestSwing) {
      biggestSwing = swing;
      biggestSwingMonth = g.date;
    }
  }
  if (biggestSwing > 200 && biggestSwingMonth) {
    badges.push({
      id: "rollercoaster",
      emoji: "🎢",
      label: "Rollercoaster",
      description: `Your rating swung by ${Math.round(biggestSwing)} points in ${biggestSwingMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })} alone.`,
      achievedAt: biggestSwingMonth.toISOString(),
    });
  }

  // "Comeback" — win a game immediately after losing the previous one by
  // 8 or more points.
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (!prev.won && prev.opponent_score - prev.own_score >= 8 && curr.won) {
      badges.push({
        id: "comeback",
        emoji: "💪",
        label: "Comeback",
        description: `Bounced back from a ${prev.own_score}–${prev.opponent_score} loss to beat ${curr.opponent_names} ${curr.own_score}–${curr.opponent_score} next time out.`,
        achievedAt: curr.played_at,
      });
      break;
    }
  }

  // "Bracket Buster" — beat a team where BOTH opponents were individually
  // rated higher than BOTH you and your partner going in. Needs each of
  // the other three players' own pre-game ratings, not just yours — see
  // teammate_pre_rating / opponent_min_pre_rating on the
  // player_match_history view (added 2026-08-11 specifically for this).
  const bracketBuster = history.find(
    (h) =>
      h.won &&
      h.teammate_pre_rating != null &&
      h.opponent_min_pre_rating != null &&
      h.pre_rating < h.opponent_min_pre_rating &&
      h.teammate_pre_rating < h.opponent_min_pre_rating
  );
  if (bracketBuster) {
    badges.push({
      id: "bracket-buster",
      emoji: "💥",
      label: "Bracket Buster",
      description: `Upset ${bracketBuster.opponent_names} even though both were rated higher than you and ${bracketBuster.teammate_name}.`,
      achievedAt: bracketBuster.played_at,
    });
  }

  // "Point Hoarder" — 1,000+ total points scored across every logged
  // match, win or lose. Tracked as a running total so we can also record
  // which game actually crossed the line, not just the final total.
  let totalPoints = 0;
  let pointHoarderAt: string | null = null;
  for (const h of history) {
    totalPoints += h.own_score;
    if (totalPoints >= 1000 && !pointHoarderAt) pointHoarderAt = h.played_at;
  }
  if (totalPoints >= 1000) {
    badges.push({
      id: "point-hoarder",
      emoji: "💰",
      label: "Point Hoarder",
      description: `Scored ${totalPoints} points across every logged match, and counting.`,
      achievedAt: pointHoarderAt,
    });
  }

  // "Steady Eddie" — rating stays within a tight band for 20 games in a
  // row. Margin chosen at 50 points: single-game swings can easily be
  // 20-40+ points while RD is still high early on, so holding the whole
  // rating within a 50-point band for 20 STRAIGHT games means genuinely
  // settled, consistent form — not just a lucky net-zero over a streak
  // that was actually swinging a lot game to game.
  const STEADY_WINDOW = 20;
  const STEADY_MARGIN = 50;
  for (let start = 0; start + STEADY_WINDOW <= history.length; start++) {
    const windowGames = history.slice(start, start + STEADY_WINDOW);
    const values = [windowGames[0].pre_rating, ...windowGames.map((h) => h.post_rating)];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min <= STEADY_MARGIN) {
      badges.push({
        id: "steady-eddie",
        emoji: "⚖️",
        label: "Steady Eddie",
        description: `Kept your rating within ${STEADY_MARGIN} points across 20 games in a row — ice in your veins.`,
        achievedAt: windowGames[windowGames.length - 1].played_at,
      });
      break;
    }
  }

  // "Top 10" / "Top 3" finish — the two deliberate exceptions to the
  // "never compares you to anyone else" rule (alongside "First time
  // pickled" above), added 2026-08-14 at Ben's explicit request. Reaching
  // Top 3 always implies Top 10, so both can fire together. Forward-only:
  // monthlyFinishes only ever contains months snapshotted after this
  // feature shipped, never backfilled.
  const monthLabel = (yearMonth: string) => {
    const [y, m] = yearMonth.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };
  const top10Finishes = monthlyFinishes.filter((f) => f.rank <= 10).sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1));
  const top3Finishes = monthlyFinishes.filter((f) => f.rank <= 3).sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1));
  if (top10Finishes.length > 0) {
    const latest = top10Finishes[0];
    badges.push({
      id: "top10-finish",
      emoji: "🔟",
      label: "Top 10 finish",
      description: `Finished a month in the club's Top 10 — ${top10Finishes.length} time${
        top10Finishes.length === 1 ? "" : "s"
      }, most recently ${monthLabel(latest.yearMonth)}.`,
      achievedAt: new Date(Number(latest.yearMonth.slice(0, 4)), Number(latest.yearMonth.slice(5, 7)), 0).toISOString(),
    });
  }
  if (top3Finishes.length > 0) {
    const latest = top3Finishes[0];
    badges.push({
      id: "top3-finish",
      emoji: "🥉",
      label: "Top 3 finish",
      description: `Finished a month in the club's Top 3 — ${top3Finishes.length} time${
        top3Finishes.length === 1 ? "" : "s"
      }, most recently ${monthLabel(latest.yearMonth)}.`,
      achievedAt: new Date(Number(latest.yearMonth.slice(0, 4)), Number(latest.yearMonth.slice(5, 7)), 0).toISOString(),
    });
  }

  // "Competition winner" / "Competition runner-up" — added 2026-08-27 at
  // Ben's request, alongside the redesigned competition title banner.
  // Fires from competition_results (placement 1 or 2) for any team this
  // player was part of. Aggregate + most-recent, same pattern as the Top
  // 10/Top 3 finish badges above — shows the count if it's happened more
  // than once, but always names the latest one.
  const wins = competitionPlacements
    .filter((p) => p.placement === 1)
    .sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1));
  const runnerUps = competitionPlacements
    .filter((p) => p.placement === 2)
    .sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1));
  if (wins.length > 0) {
    const latest = wins[0];
    badges.push({
      id: "competition-winner",
      emoji: "🏆",
      label: "Competition winner",
      description: `Won ${latest.competitionName}${wins.length > 1 ? ` — ${wins.length} times so far` : ""}.`,
      achievedAt: latest.achievedAt,
    });
  }
  if (runnerUps.length > 0) {
    const latest = runnerUps[0];
    badges.push({
      id: "competition-runner-up",
      emoji: "🥈",
      label: "Competition runner-up",
      description: `Runner-up in ${latest.competitionName}${runnerUps.length > 1 ? ` — ${runnerUps.length} times so far` : ""}.`,
      achievedAt: latest.achievedAt,
    });
  }

  // "Spring/Summer/Autumn/Winter Top 10" — one badge per season TYPE, not
  // per instance: a player who's Top 10'd in three different Summers gets
  // one "Summer Top 10" badge naming the count and the most recent one,
  // not three separate badges. Only fires for seasons that have actually
  // finished (seasonTop10Finishes is pre-filtered for that upstream in
  // Dashboard.tsx) so a live, still-changing standing never gets awarded
  // early. Added 2026-08-28 at Ben's request.
  const SEASON_EMOJI: Record<SeasonName, string> = { Spring: "🌸", Summer: "☀️", Autumn: "🍂", Winter: "❄️" };
  const SEASON_ORDER: SeasonName[] = ["Spring", "Summer", "Autumn", "Winter"];
  for (const seasonName of SEASON_ORDER) {
    const finishes = seasonTop10Finishes
      .filter((f) => f.seasonName === seasonName)
      .sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1));
    if (finishes.length > 0) {
      const latest = finishes[0];
      badges.push({
        id: `season-top10-${seasonName.toLowerCase()}`,
        emoji: SEASON_EMOJI[seasonName],
        label: `${seasonName} Top 10`,
        description: `Finished the club's Top 10 for ${seasonName} — ${finishes.length} time${
          finishes.length === 1 ? "" : "s"
        }, most recently ${latest.label}.`,
        achievedAt: latest.achievedAt,
      });
    }
  }

  return badges;
}
