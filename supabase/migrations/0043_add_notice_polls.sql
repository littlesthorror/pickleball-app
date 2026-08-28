-- Admin polls in Notices (2026-08-28) — Ben's request: a lightweight
-- yes/no or multiple-choice poll admins can attach to a notice, toggleable
-- on/off per post. Reuses the notices table/RLS rather than a separate
-- "polls" concept, since a poll here is really just an optional extra part
-- of a notice, same relationship as attachments/cover image.
alter table public.notices
  add column poll_enabled boolean not null default false,
  add column poll_question text,
  add column poll_options jsonb not null default '[]'::jsonb;

comment on column public.notices.poll_enabled is 'Admin opt-in per notice for an attached yes/no or multiple-choice poll.';
comment on column public.notices.poll_question is 'The poll question text — null/ignored when poll_enabled is false.';
comment on column public.notices.poll_options is 'Array of option label strings, e.g. ["Yes","No"] or ["Monday","Wednesday","Both"].';

create table public.notice_poll_votes (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  option_index int not null,
  created_at timestamptz not null default now(),
  unique (notice_id, player_id)
);

comment on table public.notice_poll_votes is
  'One row per member per poll they''ve voted in — unique(notice_id, player_id) so voting again just changes their choice rather than adding a second vote. Added 2026-08-28.';

alter table public.notice_poll_votes enable row level security;

create policy "poll votes readable by any logged-in member"
  on public.notice_poll_votes for select
  using (auth.role() = 'authenticated');

create policy "players can vote for themselves"
  on public.notice_poll_votes for insert
  with check (player_id = auth.uid());

create policy "players can change their own vote"
  on public.notice_poll_votes for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy "players can retract their own vote"
  on public.notice_poll_votes for delete
  using (player_id = auth.uid());
