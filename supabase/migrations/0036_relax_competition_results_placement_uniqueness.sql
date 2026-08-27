-- Dropping this: if a competition has no 3rd-place playoff, both
-- semifinal losers are recorded as joint-3rd (placement 3), which a
-- unique(competition_id, placement) constraint would block. Placement
-- ties are a legitimate, common outcome, not a data error.
alter table public.competition_results drop constraint if exists competition_results_competition_id_placement_key;
