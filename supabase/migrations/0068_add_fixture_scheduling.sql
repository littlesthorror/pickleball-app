-- Fixture scheduling (2026-09-07, Ben's request): "Save fixtures" export +
-- a court-aware way of laying out group-stage fixtures, instead of the
-- flat naive-order list that read like it was "sorted alphabetically".
--
-- `round` on competition_matches — which no-clash round a group-stage
-- fixture belongs to (no team plays twice in the same round), assigned by
-- the circle-method scheduler in generateGroupFixtures() at fixture-
-- generation time. Null for knockout matches (rounds don't apply there —
-- knockout_round already covers that) and for any group fixtures created
-- before this migration shipped (they just fall back to the old flat list
-- display, nothing breaks).
alter table public.competition_matches add column if not exists round integer;

-- `start_court` / `court_count` on competition_groups — set per group in
-- the Setup stage, right before fixtures are generated, since by then the
-- admin usually knows the day's actual court layout. Both nullable: a
-- group with no court info set just displays/exports without Round/Court
-- labels, same as before this feature existed. Court numbers themselves
-- are never stored per-match — they're derived at render/export time from
-- a match's `round` plus its group's court settings, so changing a
-- group's court count later (e.g. a court became unavailable on the day)
-- immediately reflows the printed schedule without needing to regenerate
-- any fixtures.
alter table public.competition_groups add column if not exists start_court integer;
alter table public.competition_groups add column if not exists court_count integer;
