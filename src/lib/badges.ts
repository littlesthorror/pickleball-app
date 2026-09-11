import type { PlayerMatchHistoryRow } from "../types";
import type { SeasonName } from "./seasons";
import { getSeasonForDate } from "./seasons";

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

  // 1-year/2-year anniversary — purely time-based, nothing to do with
  // results. Not gated to the non-retroactive rule used for the badge
  // batches below: this isn't reaching back into a specific past GAME the
  // way those are, it's a live, continuously-true fact about how long
  // you've been a member (same reasoning as the Completionist meta-badge —
  // see computeCompletionistBadge below).
  if (dateJoined) {
    const joined = new Date(dateJoined);
    const anniversaryMilestones = [
      { years: 1, id: "one-year", label: "1 year using Sideline" },
      { years: 2, id: "two-years", label: "2 years using Sideline" },
    ];
    for (const milestone of anniversaryMilestones) {
      const anniversaryDate = new Date(joined);
      anniversaryDate.setFullYear(anniversaryDate.getFullYear() + milestone.years);
      if (new Date() >= anniversaryDate) {
        badges.push({
          id: milestone.id,
          emoji: "🎊",
          label: milestone.label,
          description: `Joined ${joined.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}.`,
          achievedAt: anniversaryDate.toISOString(),
        });
      }
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

  // "Dream Team" (tiered) — 25+ then 50+ wins alongside the same partner.
  // Grouped by teammate name (a 2v2 team, not an individual credit split)
  // — same approach as the head-to-head record on the dashboard. Only
  // awarded for whichever partner you've won the most with, so it doesn't
  // fire separately for every partner who happens to clear a threshold.
  // "Ride or Die" (2026-09-09, Ben's request) added as the 50-win tier on
  // top of the existing 25-win badge — same partner-by-wins computation,
  // just a second, harder milestone layered on.
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
  const partnerWinMilestones = [
    { count: 25, id: "partner-25-wins", emoji: "🤝", label: "25 wins with a partner" },
    { count: 50, id: "ride-or-die", emoji: "🏍️", label: "Ride or Die" },
  ];
  for (const milestone of partnerWinMilestones) {
    if (bestPartnerWins >= milestone.count) {
      const partnerWins = history.filter((h) => h.won && h.teammate_name === bestPartnerName);
      badges.push({
        id: milestone.id,
        emoji: milestone.emoji,
        label: milestone.label,
        description: `Won ${bestPartnerWins} games alongside ${bestPartnerName}.`,
        achievedAt: partnerWins[milestone.count - 1]?.played_at ?? null,
      });
    }
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
  //
  // Games-played floor added 2026-09-09 (Ben's request: "both pairs have to
  // have registered at least 25 games") — same reasoning as The Thief's own
  // floor above: without it, an "upset" against two people also brand new
  // to the club (wild, unsettled ratings) is trivially easy and not a real
  // upset. Requires all four players — you, your partner, and both
  // opponents — to have played 25+ games by the time of the match. Uses
  // opponent_min_game_number (added specifically for this) alongside the
  // existing game_number/teammate_game_number.
  const BRACKET_BUSTER_MIN_GAMES = 25;
  const bracketBuster = history.find(
    (h) =>
      h.won &&
      h.teammate_pre_rating != null &&
      h.opponent_min_pre_rating != null &&
      h.pre_rating < h.opponent_min_pre_rating &&
      h.teammate_pre_rating < h.opponent_min_pre_rating &&
      h.game_number >= BRACKET_BUSTER_MIN_GAMES &&
      h.teammate_game_number != null &&
      h.teammate_game_number >= BRACKET_BUSTER_MIN_GAMES &&
      h.opponent_min_game_number != null &&
      h.opponent_min_game_number >= BRACKET_BUSTER_MIN_GAMES
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

  // ── 7 more badges added 2026-09-01 at Ben's request ────────────────────

  // "Clean Sweep" — shut your OPPONENTS out (they scored 0). The positive
  // mirror of "First time pickled" above (which is about being shut out
  // yourself) — just as achievable for a newer player having a great day
  // as for the club's top rating, since it only depends on that one game's
  // score.
  const cleanSweep = history.find((h) => h.won && h.opponent_score === 0);
  if (cleanSweep) {
    badges.push({
      id: "clean-sweep",
      emoji: "🧹",
      label: "Clean Sweep",
      description: `Shut out ${cleanSweep.opponent_names} ${cleanSweep.own_score}–0.`,
      achievedAt: cleanSweep.played_at,
    });
  }

  // "Clutch" — 3 separate WINS by the minimum possible margin (2 points)
  // within any 7-day window. Exact positive mirror of "Heartbreak" above —
  // same rolling-window logic, just over qualifying wins instead of
  // qualifying losses.
  const minMarginWins = history
    .filter((h) => h.won && h.own_score - h.opponent_score === 2)
    .map((h) => new Date(h.played_at).getTime())
    .sort((a, b) => a - b);
  for (let i = 0; i + 2 < minMarginWins.length; i++) {
    if (minMarginWins[i + 2] - minMarginWins[i] <= WEEK_MS) {
      const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      badges.push({
        id: "clutch",
        emoji: "🧊",
        label: "Clutch",
        description: `Won 3 games by just 2 points each, all within one week (${fmt(minMarginWins[i])}–${fmt(minMarginWins[i + 2])}).`,
        achievedAt: new Date(minMarginWins[i + 2]).toISOString(),
      });
      break;
    }
  }

  // "Deuce Duel" — won a game that went well past a normal finish (12+
  // points) but was still only decided by 2 points or less — a genuinely
  // extended, nail-biting battle, not just a high-scoring blowout (which
  // "Standout win" above already covers from the other direction). The
  // 12+/±2 combination was chosen by checking the club's actual early
  // match data for a real example of this exact shape (a 13-12 game) —
  // see the 2026-09-01 rating-swing/badge-threshold conversation.
  const deuceDuel = history.find((h) => h.won && h.own_score >= 12 && h.own_score - h.opponent_score <= 2);
  if (deuceDuel) {
    badges.push({
      id: "deuce-duel",
      emoji: "😅",
      label: "Deuce Duel",
      description: `Won ${deuceDuel.own_score}–${deuceDuel.opponent_score} against ${deuceDuel.opponent_names} — a real deuce duel.`,
      achievedAt: deuceDuel.played_at,
    });
  }

  // "Fresh Legs" — won the first game of a day you played more than one.
  // Nothing to do with skill level, just "showed up and started strong."
  // History is ordered ascending, so the first entry seen for each
  // calendar day IS that day's first game.
  const seenDays = new Set<string>();
  let freshLegs: PlayerMatchHistoryRow | null = null;
  for (const h of history) {
    const dayKey = new Date(h.played_at).toDateString();
    if (seenDays.has(dayKey)) continue;
    seenDays.add(dayKey);
    if (h.won) {
      freshLegs = h;
      break;
    }
  }
  if (freshLegs) {
    badges.push({
      id: "fresh-legs",
      emoji: "🌅",
      label: "Fresh Legs",
      description: `Won your first game of the session on ${new Date(freshLegs.played_at).toLocaleDateString(undefined, { month: "long", day: "numeric" })} — hit the ground running.`,
      achievedAt: freshLegs.played_at,
    });
  }

  // "Well Travelled" — played alongside 25+ different partners (raised from
  // 20, 2026-09-09, Ben's request). Rewards
  // being a good clubhouse citizen (playing with lots of different
  // people), not being good at pickleball — counterpart to "Dream Team"
  // above, which is specifically about ONE partner.
  const WELL_TRAVELLED_PARTNERS = 25;
  const distinctPartners = new Set(history.map((h) => h.teammate_name));
  if (distinctPartners.size >= WELL_TRAVELLED_PARTNERS) {
    // Achieved date = the game that introduced the Nth distinct partner.
    const seenPartners = new Set<string>();
    let wellTravelledAt: string | null = null;
    for (const h of history) {
      seenPartners.add(h.teammate_name);
      if (seenPartners.size >= WELL_TRAVELLED_PARTNERS) {
        wellTravelledAt = h.played_at;
        break;
      }
    }
    badges.push({
      id: "well-travelled",
      emoji: "🧭",
      label: "Well Travelled",
      description: `Played alongside ${distinctPartners.size} different partners and counting.`,
      achievedAt: wellTravelledAt,
    });
  }

  // "Marathon" — 10+ games logged in a single session (same calendar day).
  // Pure participation, not outcome — ties nicely into the Quick Entry ×4
  // flow for busy sessions.
  const MARATHON_GAMES = 10;
  const gamesByDay = new Map<string, { count: number; lastPlayedAt: string }>();
  for (const h of history) {
    const dayKey = new Date(h.played_at).toDateString();
    const entry = gamesByDay.get(dayKey) ?? { count: 0, lastPlayedAt: h.played_at };
    entry.count += 1;
    entry.lastPlayedAt = h.played_at;
    gamesByDay.set(dayKey, entry);
  }
  let marathonDay: { count: number; lastPlayedAt: string } | null = null;
  for (const day of gamesByDay.values()) {
    if (day.count >= MARATHON_GAMES) {
      marathonDay = day;
      break;
    }
  }
  if (marathonDay) {
    badges.push({
      id: "marathon",
      emoji: "🏃",
      label: "Marathon",
      description: `Played ${marathonDay.count} games in a single session on ${new Date(marathonDay.lastPlayedAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })} — legs of steel.`,
      achievedAt: marathonDay.lastPlayedAt,
    });
  }

  // "Giant Slayer" (tiered) — 3 and 10 wins against a pair who were BOTH
  // individually rated higher than both you and your partner (the same
  // upset condition "Bracket Buster" above checks for, just counted
  // across your whole history instead of firing once on the first
  // occurrence) — including Bracket Buster's 25-games-each-player floor
  // (2026-09-09, Ben's request), so an early-days upset with volatile,
  // unproven ratings doesn't count toward either badge.
  const giantSlayerWins = history.filter(
    (h) =>
      h.won &&
      h.teammate_pre_rating != null &&
      h.opponent_min_pre_rating != null &&
      h.pre_rating < h.opponent_min_pre_rating &&
      h.teammate_pre_rating < h.opponent_min_pre_rating &&
      h.game_number >= BRACKET_BUSTER_MIN_GAMES &&
      h.teammate_game_number != null &&
      h.teammate_game_number >= BRACKET_BUSTER_MIN_GAMES &&
      h.opponent_min_game_number != null &&
      h.opponent_min_game_number >= BRACKET_BUSTER_MIN_GAMES
  );
  const giantSlayerMilestones = [
    { count: 3, emoji: "💥💥", label: "Giant Slayer" },
    { count: 10, emoji: "💥💥💥", label: "Legendary Giant Slayer" },
  ];
  for (const milestone of giantSlayerMilestones) {
    if (giantSlayerWins.length >= milestone.count) {
      badges.push({
        id: `giant-slayer-${milestone.count}`,
        emoji: milestone.emoji,
        label: milestone.label,
        description: `Upset a higher-rated pair ${giantSlayerWins.length} time${giantSlayerWins.length === 1 ? "" : "s"} and counting.`,
        achievedAt: giantSlayerWins[milestone.count - 1]?.played_at ?? null,
      });
    }
  }

  // ── 4 more badges added 2026-09-02 at Ben's request ────────────────────

  // "Rating Rocket" — biggest single-GAME rating gain, 50+ points in one
  // sitting. Different angle from Rollercoaster above, which tracks the
  // full high-low RANGE across a whole month of games — this is just the
  // one biggest jump, whenever it happened. Restricted to wins so the
  // description always reads as a clean "beat X" story. Also restricted to
  // game 13 onward (2026-09-02, Ben's request) — RD is at its highest in
  // your first 12 games, so a big swing there is just how a new/uncertain
  // rating behaves, not a genuinely notable spike the way the same jump is
  // once your rating's settled down.
  const ROCKET_THRESHOLD = 50;
  const ROCKET_MIN_GAME = 12;
  const rocketGames = history.filter((h) => h.won && h.game_number > ROCKET_MIN_GAME && h.rating_delta >= ROCKET_THRESHOLD);
  if (rocketGames.length > 0) {
    const biggest = rocketGames.reduce((best, h) => (h.rating_delta > best.rating_delta ? h : best));
    badges.push({
      id: "rating-rocket",
      emoji: "🚀",
      label: "Rating Rocket",
      description: `Gained ${Math.round(biggest.rating_delta)} rating points in a single game, beating ${biggest.opponent_names} ${biggest.own_score}–${biggest.opponent_score}.`,
      achievedAt: biggest.played_at,
    });
  }

  // "Perfect Session" — won every game in a session of 3+ (a completely
  // unbeaten day). Distinct from Marathon above, which only cares about
  // raw game COUNT regardless of outcome.
  const PERFECT_SESSION_MIN = 3;
  const daySessions = new Map<string, { total: number; wins: number; lastPlayedAt: string }>();
  for (const h of history) {
    const dayKey = new Date(h.played_at).toDateString();
    const entry = daySessions.get(dayKey) ?? { total: 0, wins: 0, lastPlayedAt: h.played_at };
    entry.total += 1;
    if (h.won) entry.wins += 1;
    entry.lastPlayedAt = h.played_at;
    daySessions.set(dayKey, entry);
  }
  let perfectSession: { total: number; lastPlayedAt: string } | null = null;
  for (const day of daySessions.values()) {
    if (day.total >= PERFECT_SESSION_MIN && day.wins === day.total) {
      perfectSession = day;
      break;
    }
  }
  if (perfectSession) {
    badges.push({
      id: "perfect-session",
      emoji: "🌟",
      label: "Perfect Session",
      description: `Went unbeaten across all ${perfectSession.total} games in a single session on ${new Date(
        perfectSession.lastPlayedAt
      ).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`,
      achievedAt: perfectSession.lastPlayedAt,
    });
  }

  // "Old Foes" — beaten the same opposing pair 5+ times. Grouped by the
  // exact opponent_names string, same approach as Dream Team above but for
  // opponents instead of teammates — a fun rivalry milestone, not a
  // comparison against anyone's own record.
  const OLD_FOES_THRESHOLD = 5;
  const winsByOpponent = new Map<string, number>();
  for (const h of history) {
    if (h.won) winsByOpponent.set(h.opponent_names, (winsByOpponent.get(h.opponent_names) ?? 0) + 1);
  }
  let mostBeatenOpponent = "";
  let mostBeatenCount = 0;
  for (const [name, count] of winsByOpponent) {
    if (count > mostBeatenCount) {
      mostBeatenCount = count;
      mostBeatenOpponent = name;
    }
  }
  if (mostBeatenCount >= OLD_FOES_THRESHOLD) {
    const winsVsThem = history.filter((h) => h.won && h.opponent_names === mostBeatenOpponent);
    badges.push({
      id: "old-foes",
      emoji: "🎭",
      label: "Old Foes",
      description: `Beaten ${mostBeatenOpponent} ${mostBeatenCount} times now — quite the rivalry.`,
      achievedAt: winsVsThem[OLD_FOES_THRESHOLD - 1]?.played_at ?? null,
    });
  }

  // "Weekend Warrior" — 15+ games played on a Saturday or Sunday, combined
  // (lowered from 20, 2026-09-09, Ben's request).
  // Pure participation, like Marathon/Well Travelled above — rewards
  // showing up on weekends specifically, nothing to do with results.
  const WEEKEND_GAMES = 15;
  const weekendGames = history.filter((h) => {
    const day = new Date(h.played_at).getDay();
    return day === 0 || day === 6;
  });
  if (weekendGames.length >= WEEKEND_GAMES) {
    badges.push({
      id: "weekend-warrior",
      emoji: "🏖️",
      label: "Weekend Warrior",
      description: `Played ${weekendGames.length} games on weekends and counting.`,
      achievedAt: weekendGames[WEEKEND_GAMES - 1]?.played_at ?? null,
    });
  }

  // ── 7 more badges added 2026-09-07 at Ben's request ────────────────────

  // Non-retroactive (2026-09-07, Ben's request) — he added "The Thief" and
  // was immediately awarded it for a win from the previous week, which read
  // as odd: the badge only just started existing, so it shouldn't reach
  // back into games played before it did. Every badge ABOVE this point
  // still sweeps full history the moment it's added (that's how the
  // Rollercoaster/Bracket Buster/etc. badges got their first holders, and
  // changing that retroactively would strip badges people already have —
  // not something to do without asking). This batch of 7 is the first to
  // use the new pattern instead: only games played on/after each badge's
  // own introduction date are considered, so nothing already in the past
  // when the badge shipped can trigger it. Future badge additions should
  // follow this same approach — filter history to
  // `h.played_at >= introducedAt` before running the detection logic,
  // rather than running it against the full `history` array.
  const NEW_BADGES_INTRODUCED_AT = "2026-09-07T00:00:00Z";
  const historySinceNewBadges = history.filter(
    (h) => new Date(h.played_at).getTime() >= new Date(NEW_BADGES_INTRODUCED_AT).getTime()
  );

  // "Titanic" — won a game 19–12, then got pickled (shut out 0) in the very
  // next game. Needs two CONSECUTIVE entries in history (already ordered
  // ascending by game_number) — not just "happened at some point," the two
  // have to be back to back. Only looks at games since this badge was
  // introduced (see historySinceNewBadges above).
  for (let i = 0; i + 1 < historySinceNewBadges.length; i++) {
    const first = historySinceNewBadges[i];
    const next = historySinceNewBadges[i + 1];
    if (first.won && first.own_score === 19 && first.opponent_score === 12 && !next.won && next.own_score === 0) {
      badges.push({
        id: "titanic",
        emoji: "🚢",
        label: "Titanic",
        description: `Won 19–12 against ${first.opponent_names}, then got pickled 0–${next.opponent_score} the very next game.`,
        achievedAt: next.played_at,
      });
      break;
    }
  }

  // "Slumdog" — lost 0–10, then won the very next game 12–10. The exact
  // rags-to-riches reversal, back to back. Only games since this badge was
  // introduced (see historySinceNewBadges above).
  for (let i = 0; i + 1 < historySinceNewBadges.length; i++) {
    const first = historySinceNewBadges[i];
    const next = historySinceNewBadges[i + 1];
    if (
      !first.won &&
      first.own_score === 0 &&
      first.opponent_score === 10 &&
      next.won &&
      next.own_score === 12 &&
      next.opponent_score === 10
    ) {
      badges.push({
        id: "slumdog",
        emoji: "🐕",
        label: "Slumdog",
        description: `Lost 0–10, then came straight back to win 12–10 against ${next.opponent_names} the very next game.`,
        achievedAt: next.played_at,
      });
      break;
    }
  }

  // "Stranger Thing" — a game that finished 11–11, a genuine deadlock. Only
  // games since this badge was introduced (see historySinceNewBadges above).
  const strangerThing = historySinceNewBadges.find((h) => h.own_score === 11 && h.opponent_score === 11);
  if (strangerThing) {
    badges.push({
      id: "stranger-thing",
      emoji: "👩‍🦲",
      label: "Stranger Thing",
      description: `Your game against ${strangerThing.opponent_names} finished 11–11 — properly strange.`,
      achievedAt: strangerThing.played_at,
    });
  }

  // "The Thief" — beat the highest COMBINED-rated pairing you've ever
  // faced (the sum of both opponents' pre-game ratings — see
  // opponent_combined_pre_rating, added to the player_match_history view
  // specifically for this badge). Different from Bracket Buster/Giant
  // Slayer above, which only check whether BOTH opponents individually
  // outrated you, regardless of by how much combined. Only wins since this
  // badge was introduced (see historySinceNewBadges above) — otherwise
  // adding this badge would immediately reach back and award it for a win
  // from before it existed, which is exactly what "not retroactive" means
  // to avoid.
  //
  // Gated to players with 25+ games played (2026-09-09, Ben's request —
  // "loads of people got the new 'The Thief' award last night. Clearly
  // it's too easy to achieve"). Without a games-played floor, "the highest
  // combined rating you've ever faced" is trivially easy for anyone still
  // early in their history — their 2nd or 3rd game is automatically their
  // "best" simply for lack of competition from their own past, regardless
  // of how strong the opponents actually were. game_number is the
  // player's own sequential count as of that match (see
  // player_match_history), so this checks they'd already played at least
  // 25 games BY THE TIME of the qualifying win, not just that they've
  // played 25 games since. Since badges are computed live rather than
  // stored as a permanent ledger, this also retroactively removes the
  // badge from anyone who only qualified under the old, easier rule.
  const THIEF_MIN_GAMES = 25;
  const thiefWins = historySinceNewBadges.filter(
    (h) => h.won && h.opponent_combined_pre_rating != null && h.game_number >= THIEF_MIN_GAMES
  );
  if (thiefWins.length > 0) {
    const biggest = thiefWins.reduce((best, h) =>
      (h.opponent_combined_pre_rating as number) > (best.opponent_combined_pre_rating as number) ? h : best
    );
    badges.push({
      id: "the-thief",
      emoji: "🥷",
      label: "The Thief",
      description: `Beat ${biggest.opponent_names} — the highest combined-rated pair you've ever faced, at ${Math.round(
        biggest.opponent_combined_pre_rating!
      )} combined.`,
      achievedAt: biggest.played_at,
    });
  }

  // "Destroyer" — won a game with over 20 points to your opponents' zero.
  // Only games since this badge was introduced (see historySinceNewBadges
  // above).
  const destroyer = historySinceNewBadges.find((h) => h.won && h.own_score > 20 && h.opponent_score === 0);
  if (destroyer) {
    badges.push({
      id: "destroyer",
      emoji: "💣",
      label: "Destroyer",
      description: `Won ${destroyer.own_score}–0 against ${destroyer.opponent_names} — total annihilation.`,
      achievedAt: destroyer.played_at,
    });
  }

  // "Absolute Tank" — scored over 30 points in a single WINNING game.
  // Changed 2026-09-07 (Ben's request) from "win or lose" to require a win —
  // scoring big in a losing effort didn't feel like it should carry the
  // same weight as doing it while actually winning. Only games since this
  // badge was introduced (see historySinceNewBadges above).
  const tank = historySinceNewBadges.find((h) => h.won && h.own_score > 30);
  if (tank) {
    badges.push({
      id: "absolute-tank",
      emoji: "🛡️",
      label: "Absolute Tank",
      description: `Scored ${tank.own_score} points in a single winning game against ${tank.opponent_names}.`,
      achievedAt: tank.played_at,
    });
  }

  // "Double Disruptor" — beaten the opposing pairing you've faced more than
  // anyone else, at least once. Different from "Old Foes" above, which is
  // about your win COUNT against a pair, not how often you've come up
  // against them in the first place. Requires having actually faced them a
  // handful of times (3+) first — otherwise "most frequent" is meaningless
  // noise off just one or two early games. Only games since this badge was
  // introduced (see historySinceNewBadges above) — both the frequency count
  // and the qualifying win start fresh from the badge's introduction date.
  const DOUBLE_DISRUPTOR_MIN_MEETINGS = 3;
  const opponentFrequency = new Map<string, number>();
  for (const h of historySinceNewBadges) {
    opponentFrequency.set(h.opponent_names, (opponentFrequency.get(h.opponent_names) ?? 0) + 1);
  }
  let mostFrequentOpponent = "";
  let mostFrequentCount = 0;
  for (const [name, count] of opponentFrequency) {
    if (count > mostFrequentCount) {
      mostFrequentCount = count;
      mostFrequentOpponent = name;
    }
  }
  if (mostFrequentCount >= DOUBLE_DISRUPTOR_MIN_MEETINGS) {
    const disruptorWin = historySinceNewBadges.find((h) => h.won && h.opponent_names === mostFrequentOpponent);
    if (disruptorWin) {
      badges.push({
        id: "double-disruptor",
        emoji: "🌀",
        label: "Double Disruptor",
        description: `Beaten ${mostFrequentOpponent} — the pairing you've faced more than anyone else (${mostFrequentCount} times).`,
        achievedAt: disruptorWin.played_at,
      });
    }
  }

  // ── 11 more badges added 2026-09-07 (batch 2) at Ben's request ─────────
  // All non-retroactive, same historySinceNewBadges window as the batch
  // above (same day, so it's the same cutoff). A few of these (Nemesis
  // Slayer, Rematch, Déjà Vu, First Dance) need to know things about your
  // FULL history to make sense at all — e.g. First Dance can't tell a
  // genuinely new partner from a returning one without knowing every
  // partner you've ever had — so they read `history` for that context but
  // only ever AWARD the badge for a qualifying game inside
  // historySinceNewBadges. That's not a loophole in "not retroactive": the
  // thing being rewarded is always a fresh game, full history is just used
  // to correctly recognise what's genuinely new.

  // "Buzzer Beater" — win a game 11-10, the tightest possible finish.
  const buzzerBeater = historySinceNewBadges.find((h) => h.won && h.own_score === 11 && h.opponent_score === 10);
  if (buzzerBeater) {
    badges.push({
      id: "buzzer-beater",
      emoji: "🎯",
      label: "Buzzer Beater",
      description: `Won 11–10 against ${buzzerBeater.opponent_names} — right down to the wire.`,
      achievedAt: buzzerBeater.played_at,
    });
  }

  // "Nemesis Slayer" — beat a pair after having lost to them 5+ times
  // before. Losses are tallied across your whole history (that's just
  // "how rivalries actually built up"), but the win that finally breaks
  // the streak must be a fresh one.
  const NEMESIS_THRESHOLD = 5;
  const lossesByOpponentNemesis = new Map<string, number>();
  let nemesisSlayerWin: PlayerMatchHistoryRow | null = null;
  for (const h of history) {
    // A draw (2026-09-09) is neither a loss that builds the grudge nor a
    // win that cashes it in — skip it entirely rather than letting it
    // count toward the loss tally via the `!h.won` check below.
    if (h.draw) continue;
    if (!h.won) {
      lossesByOpponentNemesis.set(h.opponent_names, (lossesByOpponentNemesis.get(h.opponent_names) ?? 0) + 1);
      continue;
    }
    if (
      !nemesisSlayerWin &&
      (lossesByOpponentNemesis.get(h.opponent_names) ?? 0) >= NEMESIS_THRESHOLD &&
      new Date(h.played_at).getTime() >= new Date(NEW_BADGES_INTRODUCED_AT).getTime()
    ) {
      nemesisSlayerWin = h;
    }
  }
  if (nemesisSlayerWin) {
    badges.push({
      id: "nemesis-slayer",
      emoji: "⚔️",
      label: "Nemesis Slayer",
      description: `Finally beat ${nemesisSlayerWin.opponent_names} after losing to them ${NEMESIS_THRESHOLD}+ times — the rivalry's turned.`,
      achievedAt: nemesisSlayerWin.played_at,
    });
  }

  // "Rematch" — lose to a pair, then beat that exact same pair the very
  // next time you face them. "Last result vs this pair" is tracked across
  // your whole history so it correctly knows what the PREVIOUS meeting
  // was, but the win itself must be fresh.
  // Tri-state (2026-09-09) — was a plain boolean keyed on `won`, which
  // meant a draw looked identical to a loss ("prevWasLoss" would fire off
  // a draw too). A draw shouldn't set up a "rematch" — you didn't lose.
  const lastResultByOpponentRematch = new Map<string, "win" | "loss" | "draw">();
  let rematchWin: PlayerMatchHistoryRow | null = null;
  for (const h of history) {
    const prevWasLoss = lastResultByOpponentRematch.get(h.opponent_names) === "loss";
    if (
      h.won &&
      prevWasLoss &&
      !rematchWin &&
      new Date(h.played_at).getTime() >= new Date(NEW_BADGES_INTRODUCED_AT).getTime()
    ) {
      rematchWin = h;
    }
    lastResultByOpponentRematch.set(h.opponent_names, h.draw ? "draw" : h.won ? "win" : "loss");
  }
  if (rematchWin) {
    badges.push({
      id: "rematch",
      emoji: "🔁",
      label: "Rematch",
      description: `Lost to ${rematchWin.opponent_names} last time out, then beat them the very next time you met.`,
      achievedAt: rematchWin.played_at,
    });
  }

  // "Déjà Vu" — win two different games against the same opponents with
  // the exact same scoreline. Scorelines are tracked across your whole
  // history to spot the repeat, but the confirming (repeat) win must be
  // fresh.
  const seenScorelinesDejaVu = new Set<string>();
  let dejaVuWin: PlayerMatchHistoryRow | null = null;
  for (const h of history) {
    if (!h.won) continue;
    const key = `${h.opponent_names}|${h.own_score}-${h.opponent_score}`;
    if (seenScorelinesDejaVu.has(key)) {
      if (!dejaVuWin && new Date(h.played_at).getTime() >= new Date(NEW_BADGES_INTRODUCED_AT).getTime()) {
        dejaVuWin = h;
      }
    } else {
      seenScorelinesDejaVu.add(key);
    }
  }
  if (dejaVuWin) {
    badges.push({
      id: "deja-vu",
      emoji: "🪞",
      label: "Déjà Vu",
      description: `Beat ${dejaVuWin.opponent_names} ${dejaVuWin.own_score}–${dejaVuWin.opponent_score} — the exact same scoreline as a previous win against them.`,
      achievedAt: dejaVuWin.played_at,
    });
  }

  // "First Dance" — win a game the very first time you're paired with a
  // partner. "Have I played with them before" is checked across your whole
  // history (otherwise a long-standing partner would wrongly look "new"
  // the first time you play together after this badge existed), but the
  // winning game itself must be fresh.
  const seenPartnersFirstDance = new Set<string>();
  let firstDanceWin: PlayerMatchHistoryRow | null = null;
  for (const h of history) {
    const isNewPartner = !seenPartnersFirstDance.has(h.teammate_name);
    seenPartnersFirstDance.add(h.teammate_name);
    if (
      isNewPartner &&
      h.won &&
      !firstDanceWin &&
      new Date(h.played_at).getTime() >= new Date(NEW_BADGES_INTRODUCED_AT).getTime()
    ) {
      firstDanceWin = h;
    }
  }
  if (firstDanceWin) {
    badges.push({
      id: "first-dance",
      emoji: "🆕",
      label: "First Dance",
      description: `Won the very first game you played alongside ${firstDanceWin.teammate_name}.`,
      achievedAt: firstDanceWin.played_at,
    });
  }

  // "Iron Grip" — 5 wins in a row with the same partner, without a loss
  // between them. Scoped entirely to games since this badge was
  // introduced (see historySinceNewBadges above) — a fresh unbeaten run
  // starting from today, rather than trying to splice together a streak
  // that straddles the introduction date.
  const IRON_GRIP_THRESHOLD = 5;
  const gamesByPartnerIronGrip = new Map<string, PlayerMatchHistoryRow[]>();
  for (const h of historySinceNewBadges) {
    const list = gamesByPartnerIronGrip.get(h.teammate_name) ?? [];
    list.push(h);
    gamesByPartnerIronGrip.set(h.teammate_name, list);
  }
  let ironGripAt: string | null = null;
  let ironGripPartner = "";
  for (const [partner, games] of gamesByPartnerIronGrip) {
    if (ironGripAt) break;
    const sorted = [...games].sort((a, b) => a.game_number - b.game_number);
    let streak = 0;
    for (const g of sorted) {
      if (g.won) {
        streak++;
        if (streak >= IRON_GRIP_THRESHOLD) {
          ironGripAt = g.played_at;
          ironGripPartner = partner;
          break;
        }
      } else {
        streak = 0;
      }
    }
  }
  if (ironGripAt) {
    badges.push({
      id: "iron-grip",
      emoji: "🛡️",
      label: "Iron Grip",
      description: `Went ${IRON_GRIP_THRESHOLD} games unbeaten alongside ${ironGripPartner} — no cracks in that partnership.`,
      achievedAt: ironGripAt,
    });
  }

  // "Jekyll & Hyde" — won with a partner AND lost with that same partner
  // on the same calendar day.
  const dayResultsByPartner = new Map<string, { won: boolean; lost: boolean; lastAt: string }>();
  let jekyllHydeAt: string | null = null;
  let jekyllHydePartner = "";
  for (const h of historySinceNewBadges) {
    // A draw (2026-09-09) is neither a win nor a loss for this badge —
    // without this it would wrongly count as "lost" via the `else` below.
    if (h.draw) continue;
    const dayKey = `${new Date(h.played_at).toDateString()}|${h.teammate_name}`;
    const entry = dayResultsByPartner.get(dayKey) ?? { won: false, lost: false, lastAt: h.played_at };
    if (h.won) entry.won = true;
    else entry.lost = true;
    entry.lastAt = h.played_at;
    dayResultsByPartner.set(dayKey, entry);
    if (!jekyllHydeAt && entry.won && entry.lost) {
      jekyllHydeAt = h.played_at;
      jekyllHydePartner = h.teammate_name;
    }
  }
  if (jekyllHydeAt) {
    badges.push({
      id: "jekyll-hyde",
      emoji: "🔀",
      label: "Jekyll & Hyde",
      description: `Won a game AND lost a game alongside ${jekyllHydePartner} on the same day.`,
      achievedAt: jekyllHydeAt,
    });
  }

  // "The Regular" — played on the same day of the week for 8+ consecutive
  // weeks in a row.
  const REGULAR_WEEKS = 8;
  const daysByWeekday = new Map<number, number[]>();
  for (const h of historySinceNewBadges) {
    const d = new Date(h.played_at);
    const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const list = daysByWeekday.get(d.getDay()) ?? [];
    if (!list.includes(dayKey)) list.push(dayKey);
    daysByWeekday.set(d.getDay(), list);
  }
  let regularAt: string | null = null;
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let regularWeekday = "";
  for (const [weekday, dayKeys] of daysByWeekday) {
    if (regularAt) break;
    const sorted = [...dayKeys].sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diffDays = Math.round((sorted[i] - sorted[i - 1]) / (24 * 60 * 60 * 1000));
      if (diffDays === 7) {
        run++;
        if (run >= REGULAR_WEEKS) {
          regularAt = new Date(sorted[i]).toISOString();
          regularWeekday = WEEKDAY_NAMES[weekday];
          break;
        }
      } else {
        run = 1;
      }
    }
  }
  if (regularAt) {
    badges.push({
      id: "the-regular",
      emoji: "📅",
      label: "The Regular",
      description: `Played on ${regularWeekday}s for ${REGULAR_WEEKS} weeks running — like clockwork.`,
      achievedAt: regularAt,
    });
  }

  // "Four Seasons" — logged games across all four (UK meteorological)
  // seasons.
  const seasonsPlayedIn = new Set<SeasonName>();
  let fourSeasonsAt: string | null = null;
  for (const h of historySinceNewBadges) {
    seasonsPlayedIn.add(getSeasonForDate(new Date(h.played_at)).name);
    if (seasonsPlayedIn.size === 4 && !fourSeasonsAt) fourSeasonsAt = h.played_at;
  }
  if (fourSeasonsAt) {
    badges.push({
      id: "four-seasons",
      emoji: "🌍",
      label: "Four Seasons",
      description: "Played through Spring, Summer, Autumn and Winter — a full year-round member.",
      achievedAt: fourSeasonsAt,
    });
  }

  // "Photo Finish" (tiered) — won by exactly 1 point, 3 times then 10
  // times. Distinct from Buzzer Beater above (a single 11-10 win) — this
  // counts every 1-point win regardless of the actual score.
  const marginOneWins = historySinceNewBadges.filter((h) => h.won && h.own_score - h.opponent_score === 1);
  const photoFinishMilestones = [
    { count: 3, emoji: "🥊", label: "Photo Finish" },
    { count: 10, emoji: "🥊🥊", label: "Serial Photo Finisher" },
  ];
  for (const milestone of photoFinishMilestones) {
    if (marginOneWins.length >= milestone.count) {
      badges.push({
        id: `photo-finish-${milestone.count}`,
        emoji: milestone.emoji,
        label: milestone.label,
        description: `Won by exactly 1 point ${marginOneWins.length} time${marginOneWins.length === 1 ? "" : "s"} and counting.`,
        achievedAt: marginOneWins[milestone.count - 1]?.played_at ?? null,
      });
    }
  }

  // "Mentor" — played alongside 10+ different partners who were still
  // provisional (12 or fewer games played) at the time you played with
  // them. Uses teammate_game_number (added to the player_match_history
  // view specifically for this badge) rather than the teammate's CURRENT
  // provisional status, since that would drift as they rack up more games.
  const MENTOR_THRESHOLD = 10;
  const MENTOR_PROVISIONAL_GAMES = 12;
  const newPartnersSeenMentor = new Set<string>();
  let mentorAt: string | null = null;
  for (const h of historySinceNewBadges) {
    if (h.teammate_game_number != null && h.teammate_game_number <= MENTOR_PROVISIONAL_GAMES) {
      newPartnersSeenMentor.add(h.teammate_name);
      if (newPartnersSeenMentor.size === MENTOR_THRESHOLD && !mentorAt) mentorAt = h.played_at;
    }
  }
  if (mentorAt) {
    badges.push({
      id: "mentor",
      emoji: "🎓",
      label: "Mentor",
      description: `Played alongside ${newPartnersSeenMentor.size} different newer players while they were still finding their feet.`,
      achievedAt: mentorAt,
    });
  }

  // "Court Regular" — played 30+ games within a single calendar month.
  // Added 2026-09-07 at Ben's request, same non-retroactive pattern as the
  // rest of this batch (historySinceNewBadges only) — a player who happened
  // to have a 30-game month before this badge existed shouldn't be handed
  // it retroactively. Only needs to trigger once (the first month it
  // happens), not per-month, so it stops as soon as it finds a qualifying
  // month rather than tracking every month going forward.
  const COURT_REGULAR_GAMES = 30;
  const gamesByMonth = new Map<string, PlayerMatchHistoryRow[]>();
  let courtRegularAt: string | null = null;
  for (const h of historySinceNewBadges) {
    const d = new Date(h.played_at);
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    const list = gamesByMonth.get(monthKey) ?? [];
    list.push(h);
    gamesByMonth.set(monthKey, list);
    if (!courtRegularAt && list.length === COURT_REGULAR_GAMES) {
      courtRegularAt = h.played_at;
    }
  }
  if (courtRegularAt) {
    badges.push({
      id: "court-regular",
      emoji: "📆",
      label: "Court Regular",
      description: `Played ${COURT_REGULAR_GAMES} games in a single calendar month — hardly left the court.`,
      achievedAt: courtRegularAt,
    });
  }

  // ── 7 more badges added 2026-09-09 (second batch) at Ben's request ─────
  // Same non-retroactive pattern as the 2026-09-07 batch above (see
  // historySinceNewBadges/NEW_BADGES_INTRODUCED_AT comment) — a fresh
  // cutoff for this specific batch, so nothing already in a player's
  // history before this moment (an old draw, an old hat-trick day, etc.)
  // instantly hands out one of these on deploy.
  const SECOND_BATCH_INTRODUCED_AT = "2026-09-09T09:36:26Z";
  const historySinceSecondBatch = history.filter(
    (h) => new Date(h.played_at).getTime() >= new Date(SECOND_BATCH_INTRODUCED_AT).getTime()
  );

  // "Early Bird" — 15+ games played before midday (local time), across
  // your whole history — not a single-session thing like Marathon, just
  // being a morning player in general.
  const EARLY_BIRD_GAMES = 15;
  const earlyBirdGames = historySinceSecondBatch.filter((h) => new Date(h.played_at).getHours() < 12);
  if (earlyBirdGames.length >= EARLY_BIRD_GAMES) {
    badges.push({
      id: "early-bird",
      emoji: "🐦",
      label: "Early Bird",
      description: `Played ${earlyBirdGames.length} games before midday and counting — up with the sun.`,
      achievedAt: earlyBirdGames[EARLY_BIRD_GAMES - 1]?.played_at ?? null,
    });
  }

  // "Fair and Square" — your first drawn game. Nothing currently
  // celebrates a draw specifically (see the 2026-09-09 draw-support work
  // above) — draws are correctly NOT treated as losses everywhere else,
  // but there was no badge marking the moment one actually happens.
  const firstDraw = historySinceSecondBatch.find((h) => h.draw);
  if (firstDraw) {
    badges.push({
      id: "fair-and-square",
      emoji: "🟰",
      label: "Fair and Square",
      description: `Drew ${firstDraw.own_score}–${firstDraw.opponent_score} against ${firstDraw.opponent_names} — honours even.`,
      achievedAt: firstDraw.played_at,
    });
  }

  // "Peacemaker" — 10+ drawn games. Volume counterpart to "Fair and
  // Square" above (which just fires on the first one).
  const PEACEMAKER_DRAWS = 10;
  const draws = historySinceSecondBatch.filter((h) => h.draw);
  if (draws.length >= PEACEMAKER_DRAWS) {
    badges.push({
      id: "peacemaker",
      emoji: "🕊️",
      label: "Peacemaker",
      description: `Drawn ${draws.length} games and counting — nobody wins, nobody loses.`,
      achievedAt: draws[PEACEMAKER_DRAWS - 1]?.played_at ?? null,
    });
  }

  // "Hat Trick" (tiered) — days where you won 3+ games. Counts the NUMBER
  // of such days (not games), tiered the same way as Giant Slayer/Photo
  // Finish above. Distinct from "Perfect Session" (which requires an
  // entirely unbeaten day) — a hat-trick day can include losses too, it
  // just needs 3+ wins somewhere in it.
  const HAT_TRICK_WINS_PER_DAY = 3;
  const winsByDayHatTrick = new Map<string, { count: number; lastAt: string }>();
  for (const h of historySinceSecondBatch) {
    if (!h.won) continue;
    const dayKey = new Date(h.played_at).toDateString();
    const entry = winsByDayHatTrick.get(dayKey) ?? { count: 0, lastAt: h.played_at };
    entry.count += 1;
    entry.lastAt = h.played_at;
    winsByDayHatTrick.set(dayKey, entry);
  }
  const hatTrickDays = Array.from(winsByDayHatTrick.values())
    .filter((d) => d.count >= HAT_TRICK_WINS_PER_DAY)
    .sort((a, b) => new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime());
  const hatTrickMilestones = [
    { count: 3, emoji: "🎩", label: "Hat Trick" },
    { count: 10, emoji: "🎩🎩", label: "Serial Hat-Tricker" },
  ];
  for (const milestone of hatTrickMilestones) {
    if (hatTrickDays.length >= milestone.count) {
      badges.push({
        id: `hat-trick-${milestone.count}`,
        emoji: milestone.emoji,
        label: milestone.label,
        description: `Won 3+ games in a single day, ${hatTrickDays.length} time${hatTrickDays.length === 1 ? "" : "s"} and counting.`,
        achievedAt: hatTrickDays[milestone.count - 1]?.lastAt ?? null,
      });
    }
  }

  // "Old Guard" — beat a pair whose COMBINED own game counts (both
  // opponents added together) were 200+ at the time. Uses
  // opponent_combined_game_number (added specifically for this — mirrors
  // opponent_combined_pre_rating's sum-of-two pattern, but for game counts
  // instead of ratings).
  const OLD_GUARD_COMBINED_GAMES = 200;
  const oldGuardWin = historySinceSecondBatch.find(
    (h) => h.won && h.opponent_combined_game_number != null && h.opponent_combined_game_number >= OLD_GUARD_COMBINED_GAMES
  );
  if (oldGuardWin) {
    badges.push({
      id: "old-guard",
      emoji: "🏛️",
      label: "Old Guard",
      description: `Beat ${oldGuardWin.opponent_names}, a pair with ${oldGuardWin.opponent_combined_game_number} games between them — seasoned opposition.`,
      achievedAt: oldGuardWin.played_at,
    });
  }

  // "Grudge Match" — faced the same opposing pair 15+ times, regardless of
  // outcome. Different axis from "Old Foes" above (which only counts WINS
  // against a pair) — this is pure frequency, win, lose, or draw.
  const GRUDGE_MATCH_THRESHOLD = 15;
  const gamesByOpponentGrudge = new Map<string, PlayerMatchHistoryRow[]>();
  for (const h of historySinceSecondBatch) {
    const list = gamesByOpponentGrudge.get(h.opponent_names) ?? [];
    list.push(h);
    gamesByOpponentGrudge.set(h.opponent_names, list);
  }
  let grudgeOpponent = "";
  let grudgeGames: PlayerMatchHistoryRow[] = [];
  for (const [name, games] of gamesByOpponentGrudge) {
    if (games.length > grudgeGames.length) {
      grudgeGames = games;
      grudgeOpponent = name;
    }
  }
  if (grudgeGames.length >= GRUDGE_MATCH_THRESHOLD) {
    badges.push({
      id: "grudge-match",
      emoji: "🗡️",
      label: "Grudge Match",
      description: `Faced ${grudgeOpponent} ${grudgeGames.length} times now — you two just keep ending up on opposite sides.`,
      achievedAt: grudgeGames[GRUDGE_MATCH_THRESHOLD - 1]?.played_at ?? null,
    });
  }

  // "The Specialist" — 90%+ win rate with a partner you've played 15+
  // games alongside. Different from "Dream Team" above (25 wins with your
  // best partner, by raw count) — this rewards CONSISTENCY with a regular
  // partner, not volume, and only looks at partners you've played enough
  // with for the win rate to actually mean something.
  const SPECIALIST_MIN_GAMES = 15;
  const SPECIALIST_MIN_RATE = 0.9;
  const gamesByPartnerSpecialist = new Map<string, PlayerMatchHistoryRow[]>();
  for (const h of historySinceSecondBatch) {
    const list = gamesByPartnerSpecialist.get(h.teammate_name) ?? [];
    list.push(h);
    gamesByPartnerSpecialist.set(h.teammate_name, list);
  }
  let specialistPartner = "";
  let specialistGames: PlayerMatchHistoryRow[] = [];
  let specialistRate = 0;
  for (const [name, games] of gamesByPartnerSpecialist) {
    if (games.length < SPECIALIST_MIN_GAMES) continue;
    const wins = games.filter((h) => h.won).length;
    const rate = wins / games.length;
    if (rate >= SPECIALIST_MIN_RATE && rate > specialistRate) {
      specialistRate = rate;
      specialistPartner = name;
      specialistGames = games;
    }
  }
  if (specialistGames.length >= SPECIALIST_MIN_GAMES) {
    const wins = specialistGames.filter((h) => h.won).length;
    badges.push({
      id: "the-specialist",
      emoji: "🔬",
      label: "The Specialist",
      description: `Won ${wins} of ${specialistGames.length} games (${Math.round(specialistRate * 100)}%) alongside ${specialistPartner} — a partnership that just works.`,
      achievedAt: specialistGames[specialistGames.length - 1].played_at,
    });
  }

  // ── 5 more badges added 2026-09-09 (third batch) at Ben's request —
  // quirky score-pattern badges, same non-retroactive pattern as the two
  // batches above (see NEW_BADGES_INTRODUCED_AT/SECOND_BATCH_INTRODUCED_AT
  // comments). Fresh cutoff again, so an old 13-0 win etc. doesn't
  // instantly hand one of these out on deploy.
  const THIRD_BATCH_INTRODUCED_AT = "2026-09-09T09:45:43Z";
  const historySinceThirdBatch = history.filter(
    (h) => new Date(h.played_at).getTime() >= new Date(THIRD_BATCH_INTRODUCED_AT).getTime()
  );

  // "Unlucky for Some" — win a game 13–0. A specific-score badge alongside
  // the broader "Clean Sweep" above (any shutout win), same relationship
  // as Buzzer Beater (11-10) sits alongside Photo Finish (any 1-point
  // win) — both can fire off the same game.
  const unluckyForSome = historySinceThirdBatch.find((h) => h.won && h.own_score === 13 && h.opponent_score === 0);
  if (unluckyForSome) {
    badges.push({
      id: "unlucky-for-some",
      emoji: "🐈‍⬛",
      label: "Unlucky for Some",
      description: `Won 13–0 against ${unluckyForSome.opponent_names} — unlucky for some, lucky for you.`,
      achievedAt: unluckyForSome.played_at,
    });
  }

  // "Golden Point" — win a game 11–9. A nervy two-point squeaker at the
  // standard target score — distinct from "Buzzer Beater" above, which is
  // specifically an 11–10 (one-point) finish.
  const goldenPoint = historySinceThirdBatch.find((h) => h.won && h.own_score === 11 && h.opponent_score === 9);
  if (goldenPoint) {
    badges.push({
      id: "golden-point",
      emoji: "🪙",
      label: "Golden Point",
      description: `Won 11–9 against ${goldenPoint.opponent_names} — every point counted.`,
      achievedAt: goldenPoint.played_at,
    });
  }

  // "Nil by Mouth" — win 11–0, a clean shutout at the standard target
  // score specifically. Narrower than "Clean Sweep" above (any winning
  // score with the opponent held to 0) — both can fire off the same game,
  // same relationship as Unlucky for Some above sits alongside Clean
  // Sweep. Distinct from "First time pickled", which is about being shut
  // out yourself.
  const nilByMouth = historySinceThirdBatch.find((h) => h.won && h.own_score === 11 && h.opponent_score === 0);
  if (nilByMouth) {
    badges.push({
      id: "nil-by-mouth",
      emoji: "🤐",
      label: "Nil by Mouth",
      description: `Won 11–0 against ${nilByMouth.opponent_names} — not a word said in reply.`,
      achievedAt: nilByMouth.played_at,
    });
  }

  // "Double Digits" — win by exactly 10 points, whatever the actual
  // score. Sits between "Deuce Duel" above (margin of 2 or less off a
  // 12+ finish) and "Standout win" (15+ margin) — an oddly specific,
  // satisfying gap in between.
  const doubleDigits = historySinceThirdBatch.find((h) => h.won && h.own_score - h.opponent_score === 10);
  if (doubleDigits) {
    badges.push({
      id: "double-digits",
      emoji: "🔢",
      label: "Double Digits",
      description: `Won ${doubleDigits.own_score}–${doubleDigits.opponent_score} against ${doubleDigits.opponent_names} — exactly a 10-point margin.`,
      achievedAt: doubleDigits.played_at,
    });
  }

  // "Mirror Match" — won two separate games by the exact same margin on
  // the same calendar day. Any margin counts (a 3-point win twice, an
  // 8-point win twice, etc.) — the coincidence is the point, not the
  // specific number. Distinct from "Déjà Vu" above, which requires the
  // exact same SCORELINE against the same opponent, tracked across your
  // whole history — this is same margin, same day, any opponent.
  const marginsByDayMirror = new Map<string, Map<number, string>>();
  let mirrorMatchAt: string | null = null;
  let mirrorMatchMargin = 0;
  for (const h of historySinceThirdBatch) {
    if (!h.won || mirrorMatchAt) continue;
    const dayKey = new Date(h.played_at).toDateString();
    const margin = h.own_score - h.opponent_score;
    const seenMargins = marginsByDayMirror.get(dayKey) ?? new Map<number, string>();
    if (seenMargins.has(margin)) {
      mirrorMatchAt = h.played_at;
      mirrorMatchMargin = margin;
    } else {
      seenMargins.set(margin, h.played_at);
      marginsByDayMirror.set(dayKey, seenMargins);
    }
  }
  if (mirrorMatchAt) {
    badges.push({
      id: "mirror-match",
      emoji: "👯",
      label: "Mirror Match",
      description: `Won two games by exactly ${mirrorMatchMargin} points in the same session — an odd little coincidence.`,
      achievedAt: mirrorMatchAt,
    });
  }

  // ── 19 more badges added 2026-09-09 (fourth batch) at Ben's request, to
  // round the total out to 100. Same non-retroactive pattern as the three
  // batches above — fresh cutoff again. A few of these (The Apprentice,
  // Rating Milestones, On the Up) need full `history`/`ratingPoints` for
  // context, same "not a loophole" reasoning as Mentor/Rollercoaster
  // above — only the AWARDING game has to be fresh.
  const FOURTH_BATCH_INTRODUCED_AT = "2026-09-09T09:54:00Z";
  const historySinceFourthBatch = history.filter(
    (h) => new Date(h.played_at).getTime() >= new Date(FOURTH_BATCH_INTRODUCED_AT).getTime()
  );

  // "One Dozen" — win a game 12–0. Changed 2026-09-09 (Ben's request) from
  // an earlier margin-based "Baker's Dozen" (win by exactly 13) to this
  // exact-score version instead.
  const oneDozen = historySinceFourthBatch.find((h) => h.won && h.own_score === 12 && h.opponent_score === 0);
  if (oneDozen) {
    badges.push({
      id: "one-dozen",
      emoji: "🍩",
      label: "One Dozen",
      description: `Won 12–0 against ${oneDozen.opponent_names} — a dozen points, not one to spare.`,
      achievedAt: oneDozen.played_at,
    });
  }

  // "Epic Battle" — a game (win or lose) with 30+ combined points scored
  // between both sides — a genuinely long, back-and-forth session game.
  const EPIC_BATTLE_COMBINED = 30;
  const epicBattle = historySinceFourthBatch.find((h) => h.own_score + h.opponent_score >= EPIC_BATTLE_COMBINED);
  if (epicBattle) {
    badges.push({
      id: "epic-battle",
      emoji: "🎾",
      label: "Epic Battle",
      description: `A ${epicBattle.own_score}–${epicBattle.opponent_score} game against ${epicBattle.opponent_names} — ${epicBattle.own_score + epicBattle.opponent_score} points fought over.`,
      achievedAt: epicBattle.played_at,
    });
  }

  // "Bagelled" — lost 0–11 specifically. Narrower sibling of "First time
  // pickled" above (which is any losing score with you on 0) — same
  // relationship as Nil by Mouth sits alongside Clean Sweep.
  const bagelled = historySinceFourthBatch.find((h) => !h.won && !h.draw && h.own_score === 0 && h.opponent_score === 11);
  if (bagelled) {
    badges.push({
      id: "bagelled",
      emoji: "🥯",
      label: "Bagelled",
      description: `Lost 0–11 against ${bagelled.opponent_names} — everyone gets bagelled eventually.`,
      achievedAt: bagelled.played_at,
    });
  }

  // "Quarterpounder" — lost 7–13 specifically. A silly specific-score
  // sibling to "Bagelled" above, added 2026-09-11 at Ben's request
  // (in-joke description, kept verbatim rather than the usual
  // opponent-names phrasing).
  const quarterpounder = historySinceFourthBatch.find((h) => !h.won && !h.draw && h.own_score === 7 && h.opponent_score === 13);
  if (quarterpounder) {
    badges.push({
      id: "quarterpounder",
      emoji: "🍔",
      label: "Quarterpounder",
      description: "Sorry, Kate's not going to McDonalds tonight.",
      achievedAt: quarterpounder.played_at,
    });
  }

  // "Under Lights" — 25+ games played after 8pm, across your whole
  // history (raised from 15, 2026-09-09, Ben's request). Evening
  // counterpart to "Early Bird" above.
  const UNDER_LIGHTS_GAMES = 25;
  const underLightsGames = historySinceFourthBatch.filter((h) => new Date(h.played_at).getHours() >= 20);
  if (underLightsGames.length >= UNDER_LIGHTS_GAMES) {
    badges.push({
      id: "under-lights",
      emoji: "🌙",
      label: "Under Lights",
      description: `Played ${underLightsGames.length} games after 8pm and counting — a true night owl.`,
      achievedAt: underLightsGames[UNDER_LIGHTS_GAMES - 1]?.played_at ?? null,
    });
  }

  // "Podium Regular" — 3+ months finishing in the club's Top 3. A second,
  // harder tier layered on top of "Top 3 finish" above (which fires once,
  // on the first Top 3), same relationship as Ride or Die sits on top of
  // the 25-win partner badge. Uses the same forward-only top3Finishes
  // computed above — no extra cutoff needed.
  const PODIUM_REGULAR_THRESHOLD = 3;
  if (top3Finishes.length >= PODIUM_REGULAR_THRESHOLD) {
    const latest = top3Finishes[0];
    badges.push({
      id: "podium-regular",
      emoji: "🏵️",
      label: "Podium Regular",
      description: `Finished a month in the club's Top 3 ${top3Finishes.length} times now — a regular on the podium.`,
      achievedAt: new Date(Number(latest.yearMonth.slice(0, 4)), Number(latest.yearMonth.slice(5, 7)), 0).toISOString(),
    });
  }

  // "Leader" — 6+ months finishing in the club's Top 10. Same relationship
  // to "Top 10 finish" above as Podium Regular has to Top 3 finish — a
  // second, harder tier on the broader (easier) leaderboard bracket.
  const LEADER_THRESHOLD = 6;
  if (top10Finishes.length >= LEADER_THRESHOLD) {
    const latest = top10Finishes[0];
    badges.push({
      id: "leader",
      emoji: "🎖️",
      label: "Leader",
      description: `Finished a month in the club's Top 10 ${top10Finishes.length} times now — a fixture near the top.`,
      achievedAt: new Date(Number(latest.yearMonth.slice(0, 4)), Number(latest.yearMonth.slice(5, 7)), 0).toISOString(),
    });
  }

  // "World Tour" — faced 30+ different opposing pairs (raised from 25,
  // 2026-09-09, Ben's request). Counterpart to "Well Travelled" above
  // (25+ different partners) — no longer the same threshold, just the
  // opponent side instead of the teammate side.
  const WORLD_TOUR_OPPONENTS = 30;
  const distinctOpponentsWorldTour = new Set(historySinceFourthBatch.map((h) => h.opponent_names));
  if (distinctOpponentsWorldTour.size >= WORLD_TOUR_OPPONENTS) {
    const seenOpponentsWorldTour = new Set<string>();
    let worldTourAt: string | null = null;
    for (const h of historySinceFourthBatch) {
      seenOpponentsWorldTour.add(h.opponent_names);
      if (seenOpponentsWorldTour.size >= WORLD_TOUR_OPPONENTS) {
        worldTourAt = h.played_at;
        break;
      }
    }
    badges.push({
      id: "world-tour",
      emoji: "🌐",
      label: "World Tour",
      description: `Faced ${distinctOpponentsWorldTour.size} different opposing pairs and counting.`,
      achievedAt: worldTourAt,
    });
  }

  // "The Apprentice" — played alongside 6+ different established partners
  // (12+ games themselves) while YOU were still provisional (12 or fewer
  // games). Exact inverse of "Mentor" above. Threshold lowered from 10 to
  // 6, 2026-09-09, Ben's request.
  const APPRENTICE_THRESHOLD = 6;
  const APPRENTICE_PROVISIONAL_GAMES = 12;
  const veteranPartnersSeenApprentice = new Set<string>();
  let apprenticeAt: string | null = null;
  for (const h of historySinceFourthBatch) {
    if (
      h.game_number <= APPRENTICE_PROVISIONAL_GAMES &&
      h.teammate_game_number != null &&
      h.teammate_game_number > APPRENTICE_PROVISIONAL_GAMES
    ) {
      veteranPartnersSeenApprentice.add(h.teammate_name);
      if (veteranPartnersSeenApprentice.size === APPRENTICE_THRESHOLD && !apprenticeAt) apprenticeAt = h.played_at;
    }
  }
  if (apprenticeAt) {
    badges.push({
      id: "the-apprentice",
      emoji: "🧑‍🎓",
      label: "The Apprentice",
      description: `Played alongside ${veteranPartnersSeenApprentice.size} different established partners while you were still finding your feet.`,
      achievedAt: apprenticeAt,
    });
  }

  // "Rating Milestones" (tiered) — reach a 1600/1700/1800/1900/2000+
  // rating for the first time. Nothing currently marks an absolute rating
  // LEVEL (Rating Rocket is a single-game jump, Rollercoaster is a
  // monthly swing, Steady Eddie is stability) — this fills that gap.
  const ratingMilestoneThresholds = [1600, 1700, 1800, 1900, 2000];
  for (const threshold of ratingMilestoneThresholds) {
    const crossed = historySinceFourthBatch.find((h) => h.post_rating >= threshold);
    if (crossed) {
      badges.push({
        id: `rating-${threshold}`,
        emoji: "📈",
        label: `${threshold} Rating`,
        description: `Reached a ${threshold}+ rating.`,
        achievedAt: crossed.played_at,
      });
    }
  }

  // "Three-peat" — beat the same opposing pair 3 times in a row, with no
  // loss or draw against them in between. Different from "Old Foes"
  // (total win count) and "Grudge Match" (total meeting count) above —
  // this is specifically an unbroken streak against one pair.
  const THREE_PEAT_STREAK = 3;
  const streaksByOpponentThreePeat = new Map<string, number>();
  let threePeatAt: string | null = null;
  let threePeatOpponent = "";
  for (const h of historySinceFourthBatch) {
    if (threePeatAt) break;
    const key = h.opponent_names;
    if (h.won) {
      const streak = (streaksByOpponentThreePeat.get(key) ?? 0) + 1;
      streaksByOpponentThreePeat.set(key, streak);
      if (streak >= THREE_PEAT_STREAK) {
        threePeatAt = h.played_at;
        threePeatOpponent = key;
      }
    } else {
      streaksByOpponentThreePeat.set(key, 0);
    }
  }
  if (threePeatAt) {
    badges.push({
      id: "three-peat",
      emoji: "🔂",
      label: "Three-peat",
      description: `Beat ${threePeatOpponent} three times in a row, no losses in between.`,
      achievedAt: threePeatAt,
    });
  }

  // "Nightcap" — won the LAST game of a session of 3+ games. Bookend
  // counterpart to "Fresh Legs" above (which is about the FIRST game of a
  // session).
  const NIGHTCAP_MIN_SESSION = 3;
  const sessionsByDayNightcap = new Map<string, PlayerMatchHistoryRow[]>();
  for (const h of historySinceFourthBatch) {
    const dayKey = new Date(h.played_at).toDateString();
    const list = sessionsByDayNightcap.get(dayKey) ?? [];
    list.push(h);
    sessionsByDayNightcap.set(dayKey, list);
  }
  let nightcapAt: string | null = null;
  for (const games of sessionsByDayNightcap.values()) {
    if (games.length >= NIGHTCAP_MIN_SESSION && games[games.length - 1].won) {
      nightcapAt = games[games.length - 1].played_at;
      break;
    }
  }
  if (nightcapAt) {
    badges.push({
      id: "nightcap",
      emoji: "🌜",
      label: "Nightcap",
      description: `Ended a ${NIGHTCAP_MIN_SESSION}+ game session with a win — went out on a high.`,
      achievedAt: nightcapAt,
    });
  }

  // "Untouchable" — a perfect (100% win) record against one opposing pair
  // across 5+ meetings. Stricter than "Old Foes" above (just counts wins,
  // no requirement they're undefeated against that pair).
  const UNTOUCHABLE_MIN_GAMES = 5;
  const gamesByOpponentUntouchable = new Map<string, PlayerMatchHistoryRow[]>();
  for (const h of historySinceFourthBatch) {
    const list = gamesByOpponentUntouchable.get(h.opponent_names) ?? [];
    list.push(h);
    gamesByOpponentUntouchable.set(h.opponent_names, list);
  }
  let untouchableOpponent = "";
  let untouchableGames: PlayerMatchHistoryRow[] = [];
  for (const [name, games] of gamesByOpponentUntouchable) {
    if (games.length >= UNTOUCHABLE_MIN_GAMES && games.length > untouchableGames.length && games.every((h) => h.won)) {
      untouchableGames = games;
      untouchableOpponent = name;
    }
  }
  if (untouchableGames.length >= UNTOUCHABLE_MIN_GAMES) {
    badges.push({
      id: "untouchable",
      emoji: "👑",
      label: "Untouchable",
      description: `A perfect ${untouchableGames.length}–0 record against ${untouchableOpponent} — untouchable.`,
      achievedAt: untouchableGames[untouchableGames.length - 1].played_at,
    });
  }

  // "Golden Hour" — 5+ wins between 5pm and 7pm. A third time-of-day slot
  // alongside "Early Bird" (before midday) and "Under Lights" (after 8pm)
  // above.
  const GOLDEN_HOUR_WINS = 5;
  const goldenHourWins = historySinceFourthBatch.filter((h) => {
    if (!h.won) return false;
    const hour = new Date(h.played_at).getHours();
    return hour >= 17 && hour < 19;
  });
  if (goldenHourWins.length >= GOLDEN_HOUR_WINS) {
    badges.push({
      id: "golden-hour",
      emoji: "🌇",
      label: "Golden Hour",
      description: `Won ${goldenHourWins.length} games between 5 and 7pm and counting — prime time form.`,
      achievedAt: goldenHourWins[GOLDEN_HOUR_WINS - 1]?.played_at ?? null,
    });
  }

  // "Century Club" — 200+ points scored within a single calendar month,
  // only counting games from your 25th lifetime game onward (2026-09-09,
  // Ben's request) — a newer player's first few sessions shouldn't count
  // toward this. Distinct from "Point Hoarder" above, which is a
  // 1000-point LIFETIME total with no such floor.
  const CENTURY_CLUB_POINTS = 200;
  const CENTURY_CLUB_MIN_GAMES = 25;
  const pointsByMonthCentury = new Map<string, { total: number }>();
  let centuryClubAt: string | null = null;
  for (const h of historySinceFourthBatch) {
    if (centuryClubAt) break;
    if (h.game_number < CENTURY_CLUB_MIN_GAMES) continue;
    const d = new Date(h.played_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const entry = pointsByMonthCentury.get(key) ?? { total: 0 };
    entry.total += h.own_score;
    pointsByMonthCentury.set(key, entry);
    if (entry.total >= CENTURY_CLUB_POINTS) centuryClubAt = h.played_at;
  }
  if (centuryClubAt) {
    badges.push({
      id: "century-club",
      emoji: "💯",
      label: "Century Club",
      description: `Scored ${CENTURY_CLUB_POINTS}+ points in a single calendar month.`,
      achievedAt: centuryClubAt,
    });
  }

  // "Taste of Everything" — won, lost, AND drew a game all within the
  // same calendar DAY (changed from "same month" to "same day", 2026-09-09,
  // Ben's request — a much tighter, session-scoped coincidence). A fun one
  // made possible by draw support (2026-09-09) — sampled every possible
  // result in one sitting.
  const dayResultsTaste = new Map<string, { win: boolean; loss: boolean; draw: boolean }>();
  let tasteOfEverythingAt: string | null = null;
  for (const h of historySinceFourthBatch) {
    if (tasteOfEverythingAt) break;
    const key = new Date(h.played_at).toDateString();
    const entry = dayResultsTaste.get(key) ?? { win: false, loss: false, draw: false };
    if (h.draw) entry.draw = true;
    else if (h.won) entry.win = true;
    else entry.loss = true;
    dayResultsTaste.set(key, entry);
    if (entry.win && entry.loss && entry.draw) tasteOfEverythingAt = h.played_at;
  }
  if (tasteOfEverythingAt) {
    badges.push({
      id: "taste-of-everything",
      emoji: "🍽️",
      label: "Taste of Everything",
      description: `Won, lost, AND drew a game — all in the same session.`,
      achievedAt: tasteOfEverythingAt,
    });
  }

  // "On the Up" — gained 100+ rating points, net, within a single calendar
  // month, only counting games from your 25th lifetime game onward
  // (2026-09-09, Ben's request) — early-career swings are just how a new,
  // uncertain rating behaves (same reasoning as Rating Rocket's own game-13
  // floor above), not a genuine climb. Distinct from "Rollercoaster"
  // above, which measures the full RANGE (up and down) rather than net
  // direction. Builds its own points array (rather than reusing
  // Rollercoaster's full-history one) seeded from the rating you entered
  // your 25th game at, so the "start of month" baseline never includes
  // pre-floor volatility. Only awards for a qualifying month that closes
  // inside this batch's cutoff window (see FOURTH_BATCH_INTRODUCED_AT
  // comment above).
  const ON_THE_UP_GAIN = 100;
  const ON_THE_UP_MIN_GAMES = 25;
  const onTheUpEligibleHistory = history.filter((h) => h.game_number >= ON_THE_UP_MIN_GAMES);
  let onTheUpAt: string | null = null;
  let onTheUpGain = 0;
  if (onTheUpEligibleHistory.length > 0) {
    const onTheUpPoints = [
      { date: onTheUpEligibleHistory[0].played_at, rating: onTheUpEligibleHistory[0].pre_rating },
      ...onTheUpEligibleHistory.map((h) => ({ date: h.played_at, rating: h.post_rating })),
    ];
    const monthNetChangeOnTheUp = new Map<string, { start: number; end: number; lastAt: string }>();
    for (let i = 1; i < onTheUpPoints.length; i++) {
      const key = monthKey(onTheUpPoints[i].date);
      if (!monthNetChangeOnTheUp.has(key)) {
        monthNetChangeOnTheUp.set(key, { start: onTheUpPoints[i - 1].rating, end: onTheUpPoints[i].rating, lastAt: onTheUpPoints[i].date });
      }
      const g = monthNetChangeOnTheUp.get(key)!;
      g.end = onTheUpPoints[i].rating;
      g.lastAt = onTheUpPoints[i].date;
    }
    for (const g of monthNetChangeOnTheUp.values()) {
      const gain = g.end - g.start;
      if (gain >= ON_THE_UP_GAIN && new Date(g.lastAt).getTime() >= new Date(FOURTH_BATCH_INTRODUCED_AT).getTime()) {
        onTheUpAt = g.lastAt;
        onTheUpGain = gain;
        break;
      }
    }
  }
  if (onTheUpAt) {
    badges.push({
      id: "on-the-up",
      emoji: "⬆️",
      label: "On the Up",
      description: `Gained ${Math.round(onTheUpGain)} rating points, net, in a single calendar month — a genuine climb.`,
      achievedAt: onTheUpAt,
    });
  }

  return badges;
}

// Trophy-style badges (competition/cup placements) are exempt from the
// "same badge only counts once" dedup below — a player can genuinely win
// several different competitions or cups over time, and each is its own
// achievement. Everything else (Rollercoaster, streak badges, etc.) is
// about a single underlying fact about you, so it should never appear
// twice no matter how it was awarded.
const TROPHY_ID_PREFIXES = ["competition-", "quarterly-cup-"];

function isTrophyBadge(id: string): boolean {
  return TROPHY_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

// Removes duplicate badges by label. Added 2026-09-07 after a player ended
// up with "Rollercoaster" twice — a legacy_badges grandfather grant (see
// the migration referenced in the Rollercoaster comment above) plus the
// live computeBadges() check both separately awarding it. Computed badges
// are kept over a same-label legacy one when both are present (the caller
// is expected to list computed badges first — see Dashboard.tsx), since
// the computed version reflects live data rather than a point-in-time
// admin grant.
export function dedupeBadges(badges: Badge[]): Badge[] {
  const seenLabels = new Set<string>();
  const result: Badge[] = [];
  for (const b of badges) {
    if (isTrophyBadge(b.id)) {
      result.push(b);
      continue;
    }
    if (seenLabels.has(b.label)) continue;
    seenLabels.add(b.label);
    result.push(b);
  }
  return result;
}

// "Completionist" — a meta-badge for reaching 50 total badges. This has to
// live outside computeBadges() (called separately, by the caller, on the
// final merged-and-deduped array — see Dashboard.tsx) because it's the only
// badge that needs to see admin-granted legacy_badges as well as computed
// ones, and computeBadges() has no visibility into legacy_badges at all.
// Threshold raised from an earlier draft to 50 at Ben's request
// (2026-09-07). achievedAt is set to the 50th badge's OWN achievedAt
// (sorted oldest-first) rather than "today" — that's the date the milestone
// was actually reached, which is more accurate and also isn't a
// retroactivity violation: every one of those 50 badges is already
// legitimately dated, this is just tallying them, not reaching back to
// credit anything new.
const COMPLETIONIST_THRESHOLD = 50;

export function computeCompletionistBadge(finalBadges: Badge[]): Badge | null {
  const dated = finalBadges.filter((b) => b.achievedAt && b.id !== "completionist");
  if (dated.length < COMPLETIONIST_THRESHOLD) return null;
  const sorted = [...dated].sort((a, b) => new Date(a.achievedAt as string).getTime() - new Date(b.achievedAt as string).getTime());
  const milestoneBadge = sorted[COMPLETIONIST_THRESHOLD - 1];
  return {
    id: "completionist",
    emoji: "🏅",
    label: "Completionist",
    description: `Earned ${COMPLETIONIST_THRESHOLD} badges — a Sideline completionist.`,
    achievedAt: milestoneBadge.achievedAt,
  };
}

// Cosmetic avatar frame tiers (2026-09-02, Ben's request) — a purely
// decorative unlock as someone racks up total badges (computed + legacy
// combined, i.e. badges.length from the array above). Zero gameplay/rating
// impact, just a small flourish next to their name — appeals to
// completionists without touching competitiveness. Ordered richest-first so
// callers can find(t => count >= t.threshold) for the highest tier reached.
export type FrameTier = "gold" | "silver" | "bronze";

export const FRAME_TIERS: { tier: FrameTier; threshold: number; label: string }[] = [
  { tier: "gold", threshold: 40, label: "Gold" },
  { tier: "silver", threshold: 30, label: "Silver" },
  { tier: "bronze", threshold: 15, label: "Bronze" },
];

export function getFrameTier(totalBadgeCount: number): FrameTier | null {
  return FRAME_TIERS.find((t) => totalBadgeCount >= t.threshold)?.tier ?? null;
}
