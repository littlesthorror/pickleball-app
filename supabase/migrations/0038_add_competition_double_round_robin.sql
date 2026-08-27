alter table public.competitions
  add column double_round_robin boolean not null default false;

alter table public.competition_matches
  add column leg smallint not null default 1;
