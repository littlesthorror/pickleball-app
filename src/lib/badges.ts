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
        label: "1 year at the club",
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

  // Longest winning streak, purely as a personal-best — shown even if it's
  // short (a 2-game streak is still a nice thing to see for a newer
  // player), never framed as a ranking against anyone else.
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
  if (longestStreak >= 3) {
    badges.push({
      id: "streak",
      emoji: "🔥",
      label: `${longestStreak}-game winning streak`,
      description: "Your best run so far.",
    });
  }

  // "Big win" — the single largest rating gain from one match, a decent
  // proxy for an upset without needing to store/compare opponent ratings
  // directly. Only shown once, for the standout result.
  const wins = history.filter((h) => h.won && h.rating_delta > 0);
  if (wins.length > 0) {
    const biggest = wins.reduce((best, h) => (h.rating_delta > best.rating_delta ? h : best));
    if (biggest.rating_delta >= 12) {
      badges.push({
        id: "big-win",
        emoji: "⚡",
        label: "Standout win",
        description: `Your biggest rating jump from a single win, vs ${biggest.opponent_names}.`,
      });
    }
  }

  // 20+ points scored in a single game.
  const bigScore = history.find((h) => h.own_score >= 20);
  if (bigScore) {
    badges.push({
      id: "big-score",
      emoji: "🎯",
      label: "20+ points in a game",
      description: `Scored ${bigScore.own_score} points in a single game.`,
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
