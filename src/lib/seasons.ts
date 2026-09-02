// UK meteorological seasons (not calendar quarters — these are offset by
// one month): Spring = Mar/Apr/May, Summer = Jun/Jul/Aug,
// Autumn = Sep/Oct/Nov, Winter = Dec/Jan/Feb. Winter is the odd one out
// since it spans a calendar year boundary — Jan/Feb belong to the Winter
// that started the previous December, not a new one.
//
// Ratings never reset between seasons (Ben's explicit requirement,
// 2026-08-14) — a season is purely a way of slicing up the existing,
// continuous match history for display, never a discontinuity in the
// underlying data. That's what makes everything here safely derivable on
// demand rather than needing to be stored: nothing about a past season is
// ever "lost", so there's no snapshotting step like the monthly Top 10 /
// Club Player features needed.

export type SeasonName = "Spring" | "Summer" | "Autumn" | "Winter";

export interface Season {
  name: SeasonName;
  // The calendar year the season STARTS in — for Winter that's the
  // December, not the following Jan/Feb.
  startYear: number;
  start: Date;
  // Exclusive upper bound — the instant the next season begins.
  nextStart: Date;
  // Stable identifier, e.g. "2026-autumn" — sorts correctly as a plain
  // string since startYear always leads.
  key: string;
  // Display label, e.g. "Autumn 2026" or "Winter 2026/27".
  label: string;
}

// Seasons before this are never shown or tracked anywhere in the app —
// the site (and the club's use of it) only really began around here, and
// Ben explicitly chose to start Seasons fresh from launch rather than
// backfill anything. First tracked season is Autumn 2026.
export const TRACKING_START = new Date(2026, 8, 1); // 1 Sept 2026

function seasonFor(name: SeasonName, startYear: number): Season {
  const monthByName: Record<SeasonName, number> = { Spring: 2, Summer: 5, Autumn: 8, Winter: 11 };
  const start = new Date(startYear, monthByName[name], 1);
  const nextStart = new Date(startYear, monthByName[name] + 3, 1);
  const key = `${startYear}-${name.toLowerCase()}`;
  const label = name === "Winter" ? `Winter ${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}` : `${name} ${startYear}`;
  return { name, startYear, start, nextStart, key, label };
}

export function getSeasonForDate(date: Date): Season {
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();
  if (month === 11) return seasonFor("Winter", year);
  if (month === 0 || month === 1) return seasonFor("Winter", year - 1);
  if (month >= 2 && month <= 4) return seasonFor("Spring", year);
  if (month >= 5 && month <= 7) return seasonFor("Summer", year);
  return seasonFor("Autumn", year);
}

export function getCurrentSeason(): Season {
  return getSeasonForDate(new Date());
}

export function getPreviousSeason(season: Season): Season {
  // One day before this season's start is always the last day of the
  // previous one.
  const dayBefore = new Date(season.start.getTime() - 24 * 60 * 60 * 1000);
  return getSeasonForDate(dayBefore);
}

export function getNextSeason(season: Season): Season {
  return getSeasonForDate(season.nextStart);
}

// Every tracked season from TRACKING_START up to (and including) the
// current one, oldest first. Small and grows by one every ~3 months, so
// no pagination or windowing needed for a long while.
export function getTrackedSeasons(): Season[] {
  const seasons: Season[] = [];
  let s = getSeasonForDate(TRACKING_START);
  const current = getCurrentSeason();
  while (s.start <= current.start) {
    seasons.push(s);
    if (s.key === current.key) break;
    s = getNextSeason(s);
  }
  return seasons;
}

// Last calendar day of a season, plus how many days remain from `now` —
// added 2026-09-02 at Ben's request to show "ends [date]" on the current
// season widget. `nextStart` is an exclusive upper bound (the instant the
// next season begins), so the last day is just one day before that.
export function getSeasonEndInfo(season: Season, now: Date = new Date()): { lastDay: Date; daysLeft: number } {
  const lastDay = new Date(season.nextStart.getTime() - 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(0, Math.ceil((season.nextStart.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  return { lastDay, daysLeft };
}

// How many days into a season the "new season" banner stays up for.
const NEW_SEASON_BANNER_DAYS = 5;

export function isWithinNewSeasonWindow(now: Date = new Date()): boolean {
  const season = getSeasonForDate(now);
  if (season.start < TRACKING_START) return false;
  const daysIn = (now.getTime() - season.start.getTime()) / (24 * 60 * 60 * 1000);
  return daysIn >= 0 && daysIn < NEW_SEASON_BANNER_DAYS;
}
