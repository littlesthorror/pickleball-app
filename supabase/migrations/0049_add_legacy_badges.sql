-- Manual "grant a legacy badge" tool (2026-08-28), for real achievements
-- that happened before this app's history could capture them — e.g. a
-- club competition run before the in-app Competitions feature existed.
-- Every OTHER badge in the app is purely computed from stored match/
-- competition data (see src/lib/badges.ts computeBadges()) — there's
-- deliberately no "grant a badge" mechanism for those, since they should
-- only ever reflect what actually happened in the data. This table is the
-- one deliberate exception: a small admin-only manual entry, clearly
-- separate from the computed set, merged in client-side on the Dashboard
-- alongside the computed badges.

create table public.legacy_badges (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  emoji text not null,
  label text not null,
  description text not null,
  achieved_at date not null default current_date,
  granted_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.legacy_badges enable row level security;

create policy "legacy badges readable by any logged-in member"
  on public.legacy_badges for select
  using (auth.role() = 'authenticated');

create policy "only admins can grant legacy badges"
  on public.legacy_badges for insert
  with check (is_admin());

create policy "only admins can revoke legacy badges"
  on public.legacy_badges for delete
  using (is_admin());
