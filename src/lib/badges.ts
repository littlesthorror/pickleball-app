import type { PlayerMatchHistoryRow } from "../types";

export interface Badge {
  id: string;
  emoji: string;
  label: string;
  description: string;
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
  dateJoined: string
): Badge[] {
  const badges: Badge[] = [];

  const firstWin = history.find((h) => h.won);
  if (firstWin) {
    badges.push({
      id: "first-win",
      emoji: "🎉",
      label: "First win",
      description: `Beat ${firstWin.opponent_names} on your way to your first W.`,
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
      });
    }
  }

  const gameMilestones = [10, 25, 50, 100, 200, 250, 500];
  for (const milestone of gameMilestones) {
    if (gamesPlayed >= milestone) {
      badges.push({
        id: `games-${milestone}`,
        emoji: milestone >= 100 ? "🏆" : "📈",
        label: `${milestone} games played`,
        description: `Logged ${milestone}+ confirmed matches.`,
      });
    }
  }

  // "Games won" milestones — added 2026-08-11 at Ben's request. Separate
  // from the games-played milestones above: this counts only the Ws, not
  // every confirmed match logged.
  const gamesWon = history.filter((h) => h.won).length;
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
    badges.push({
      id: "partner-25-wins",
      emoji: "🤝",
      label: `${PARTNER_WIN_MILESTONE} wins with a partner`,
      description: `Won ${bestPartnerWins} games alongside ${bestPartnerName}.`,
    });
  }

  // Longest winning streak, purely as a personal-best — shown even if it's
  // short (a 2-game streak is still a nice thing to see for a newer
  // player), never framed as a ranking against anyone else.
  //
  // Tiered like the games-played milestones: every threshold reached gets
  // its own badge, with the fire emoji count going up per tier (added
  // 2026-08-10 at Ben's request).
  let longestStreak = 0;
  let current = 0;
  for (const h of history) {
    if (h.won) {
      current += 1;
      longestStreak = Math.max(longestStreak, current);
    } else {
      current = 0;
    }
  }
  const streakMilestones = [
    { games: 3, emoji: "🔥" },
    { games: 6, emoji: "🔥🔥" },
    { games: 10, emoji: "🔥🔥🔥" },
  ];
  for (const milestone of streakMilestones) {
    if (longestStreak >= milestone.games) {
      badges.push({
        id: `streak-${milestone.games}`,
        emoji: milestone.emoji,
        label: `${milestone.games}-game winning streak`,
        description: `Reached a ${milestone.games}-game winning streak — your best run so far is ${longestStreak}.`,
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
    });
  }

  return badges;
}
