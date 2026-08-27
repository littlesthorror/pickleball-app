alter table public.events add column if not exists rsvp_enabled boolean not null default true;
