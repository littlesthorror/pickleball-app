-- Fixes a real scheduling bug found 2026-09-25 while testing the new
-- per-match court override: editing ONE fixture's court was reshuffling
-- the displayed Round/Court of completely unrelated fixtures in the same
-- group.
--
-- Root cause: scheduleFixturesByCourt (src/lib/competitionStandings.ts)
-- chunks a group's fixtures into printed rounds/courts purely by their
-- position in the array it's given, and the app's fetch of
-- competition_matches had no ORDER BY at all — worse, even adding one on
-- created_at (an earlier attempt at this same fix) doesn't actually help,
-- because every fixture in a group is inserted in a single bulk INSERT
-- (see "Start competition" in Competitions.tsx) and therefore shares the
-- exact same created_at timestamp down to the microsecond. Postgres makes
-- no promise about the order it returns rows in when the ORDER BY column
-- is tied, so the array order — and therefore the printed Round/Court
-- chunking — could silently differ between one page load and the next,
-- with no actual data change at all.
--
-- fixture_order is a plain sequential integer, unique per fixture within
-- its generation batch, set once at insert time and never touched again.
-- Ordering by it is fully deterministic forever, regardless of what
-- Postgres's physical row order happens to be.
alter table public.competition_matches
  add column if not exists fixture_order integer;

-- Backfill already-generated fixtures (matches inserted before this
-- column existed) with SOME fixed order now, per group — it can't
-- perfectly recreate whatever order an admin happened to see on a past
-- page load (nothing recorded what that was), but locking in any
-- consistent order from this point on is what actually matters: it stops
-- the reshuffling for good. Ordered by round then id as a reasonable,
-- fully deterministic tiebreak.
with ordered as (
  select
    id,
    row_number() over (
      partition by group_id
      order by round nulls last, id
    ) as rn
  from public.competition_matches
  where group_id is not null
)
update public.competition_matches cm
set fixture_order = ordered.rn
from ordered
where cm.id = ordered.id
  and cm.fixture_order is null;
