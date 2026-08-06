-- Admin-only events calendar: upcoming competitions, socials, game nights.
-- Any signed-in club member can view; only admins can create/edit/delete.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  event_time time,
  location text,
  created_by uuid references public.players (id),
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "events readable by any logged-in member"
  on public.events for select
  using (auth.role() = 'authenticated');

create policy "only admins can create events"
  on public.events for insert
  with check (public.is_admin());

create policy "only admins can update events"
  on public.events for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "only admins can delete events"
  on public.events for delete
  using (public.is_admin());
