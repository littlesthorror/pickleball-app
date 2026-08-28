alter table public.events
  add column weather_enabled boolean not null default false;

comment on column public.events.weather_enabled is
  'Admin opt-in per event (2026-08-28) to show an auto-refreshed weather forecast on the event card/ticket. Off by default since not every event is outdoors or benefits from it.';
