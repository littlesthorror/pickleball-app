alter table public.competitions
  add column scoring_system text not null default 'standard'
  check (scoring_system in ('standard', 'social'));
