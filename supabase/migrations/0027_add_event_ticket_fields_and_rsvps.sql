-- Events ticket-detail feature (2026-08-15). Adds the fields the new
-- ticket popup needs (format/host/external link/capacity/waitlist toggle/
-- placeholder poster style) plus a table to track real RSVP interest.

alter table public.events
  add column format text,
  add column hosted_by text,
  add column external_url text,
  add column capacity int,
  add column waitlist_enabled boolean not null default false,
  -- Which themed placeholder to show when no real poster's been uploaded
  -- yet — 'trophy' (navy, competitions) or 'social' (orange, socials).
  -- Null means no placeholder chosen yet (falls back to a generic style).
  add column poster_placeholder text check (poster_placeholder in ('trophy', 'social'));

create table public.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null check (status in ('going', 'waitlist')),
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);

alter table public.event_rsvps enable row level security;

create policy "rsvps readable by any logged-in member"
  on public.event_rsvps for select
  using (auth.role() = 'authenticated');

create policy "players can rsvp for themselves"
  on public.event_rsvps for insert
  with check (player_id = auth.uid());

create policy "players can change their own rsvp"
  on public.event_rsvps for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy "players can cancel their own rsvp"
  on public.event_rsvps for delete
  using (player_id = auth.uid());
