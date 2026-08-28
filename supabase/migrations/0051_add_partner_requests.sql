-- Partner-finder board (2026-08-28) — Ben's request: "Looking for a doubles
-- partner Tuesday 6pm" style open invites, without adding a whole new nav
-- tab/page. Deliberately lives as a small Dashboard widget only (see
-- Dashboard.tsx) — this migration is just the data model underneath it.
--
-- A request is a short note + optional date/time, posted by one member.
-- Other members express interest by joining it (partner_request_interests),
-- which pushes a notification to the poster (see Dashboard.tsx's join
-- handler calling the send-push edge function directly, same pattern as
-- notify-post-match). No admin involvement needed — any member can post,
-- join, or cancel their own request, same trust level as RSVPing to an
-- event.

create table public.partner_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  note text not null,
  play_date date,
  play_time text,
  created_at timestamptz not null default now()
);

comment on table public.partner_requests is
  'Open "looking for a partner" invites posted by members — surfaced as a small widget on the Dashboard, not a dedicated page. Added 2026-08-28.';
comment on column public.partner_requests.note is 'Free-text note, e.g. "Looking for a doubles partner, happy to play any level."';
comment on column public.partner_requests.play_date is 'Optional — when they''re hoping to play. Null means "any time / flexible".';
comment on column public.partner_requests.play_time is 'Optional free-text time, e.g. "6pm" or "morning" — kept as text rather than a time column since members phrase this loosely.';

alter table public.partner_requests enable row level security;

create policy "partner requests readable by any logged-in member"
  on public.partner_requests for select
  using (auth.role() = 'authenticated');

create policy "players can post their own partner request"
  on public.partner_requests for insert
  with check (player_id = auth.uid());

create policy "players can cancel their own partner request"
  on public.partner_requests for delete
  using (player_id = auth.uid() or is_admin());

create table public.partner_request_interests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.partner_requests(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (request_id, player_id)
);

comment on table public.partner_request_interests is
  'One row per member who taps "I''m in" on a partner request — unique(request_id, player_id) so it''s a toggle, not a repeatable action. Added 2026-08-28.';

alter table public.partner_request_interests enable row level security;

create policy "interests readable by any logged-in member"
  on public.partner_request_interests for select
  using (auth.role() = 'authenticated');

create policy "players can express interest for themselves"
  on public.partner_request_interests for insert
  with check (player_id = auth.uid());

create policy "players can retract their own interest"
  on public.partner_request_interests for delete
  using (player_id = auth.uid());
