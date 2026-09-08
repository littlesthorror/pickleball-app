-- Lets an admin allow attendees to bring a +1 guest when RSVPing to an
-- event (2026-09-08, Ben's request) — e.g. socials/tournaments where
-- members often want to bring a partner or friend along.
--
-- allow_plus_one is the admin's per-event toggle (Events.tsx create/edit
-- form). plus_one on event_rsvps is each individual attendee's own
-- choice when they RSVP, only meaningful when the event allows it — the
-- app only ever sets it true when event.allow_plus_one is true, but it's
-- not DB-enforced since it's harmless either way (an orphaned true on an
-- event that later has +1s turned off just stops being read).
--
-- promote_event_waitlist (0030) is replaced to count a +1 RSVP as
-- occupying 2 spots instead of 1 — both for deciding how many spots are
-- open, and for how many waitlisted rows can be promoted into them.

alter table public.events
  add column allow_plus_one boolean not null default false;

alter table public.event_rsvps
  add column plus_one boolean not null default false;

create or replace function public.promote_event_waitlist(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_occupied integer;
  v_spots_open integer;
  v_rec record;
  v_party_size integer;
begin
  select capacity into v_capacity from public.events where id = p_event_id;

  -- Unlimited-capacity events have no waitlist concept to promote into.
  if v_capacity is null then
    return;
  end if;

  select coalesce(sum(case when plus_one then 2 else 1 end), 0) into v_occupied
  from public.event_rsvps
  where event_id = p_event_id and status = 'going';

  v_spots_open := v_capacity - v_occupied;

  if v_spots_open <= 0 then
    return;
  end if;

  -- Promote the longest-waiting rows first, same FIFO order as before —
  -- but each waitlisted row can now need 1 or 2 spots depending on its
  -- own +1. Stops at the first row that wouldn't fit rather than skipping
  -- ahead to a smaller party further back in the queue, to keep it fair.
  for v_rec in
    select id, plus_one from public.event_rsvps
    where event_id = p_event_id and status = 'waitlist'
    order by created_at asc
  loop
    v_party_size := case when v_rec.plus_one then 2 else 1 end;
    exit when v_party_size > v_spots_open;
    update public.event_rsvps set status = 'going' where id = v_rec.id;
    v_spots_open := v_spots_open - v_party_size;
  end loop;
end;
$$;
