alter table public.events
  add column is_private boolean not null default false;

comment on column public.events.is_private is
  'Admin-only "save the date" entries — visible on the calendar/lists to admins only, hidden from regular members entirely (enforced by RLS below, not just the UI). Added 2026-08-28.';

-- Replace the blanket "any logged-in member" SELECT policy with one that
-- also hides private events from non-admins. Regular events behave
-- exactly as before; only is_private=true rows are now gated.
drop policy "events readable by any logged-in member" on public.events;

create policy "events readable by any logged-in member"
  on public.events for select
  using (auth.role() = 'authenticated' and (not is_private or is_admin()));
