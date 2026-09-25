-- Per-match court override (2026-09-25, Ben's request) — the Round/Court
-- shown on each group-stage fixture is normally computed on the fly from
-- the group's start_court/court_count (see scheduleFixturesByCourt in
-- src/lib/competitionStandings.ts), never stored. That's fine for fixing
-- the whole group's layout at once (the "Edit courts" section added
-- earlier today), but doesn't cover the day-of case where one specific
-- match needs to move to a different court than its slot would otherwise
-- compute to (a court's unexpectedly unavailable, players get shuffled
-- around on the day, etc).
--
-- This column lets a single fixture's printed court be pinned independent
-- of the group-wide schedule. Null (the default, and by far the common
-- case) means "use the computed value as before" — scheduleFixturesByCourt
-- only substitutes this in when it's set. Deliberately nullable with no
-- default other than null, and deliberately not touching `round` at all —
-- overriding a court doesn't change which round of the schedule the match
-- prints under, just which court number is shown for it.
alter table public.competition_matches
  add column if not exists court_override integer;
