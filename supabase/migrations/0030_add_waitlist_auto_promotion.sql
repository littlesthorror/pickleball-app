-- Auto-promote waitlisted players into the "going" list whenever a spot
-- frees up, either because someone going cancels (event_rsvps row deleted)
-- or an admin raises an event's capacity. Runs as security definer so it
-- can update other players' rsvp rows regardless of who triggers it.

create or replace function public.promote_event_waitlist(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_going_count integer;
  v_spots_open integer;
begin
  select capacity into v_capacity from public.events where id = p_event_id;

  -- Unlimited-capacity events have no waitlist concept to promote into.
  if v_capacity is null then
    return;
  end if;

  select count(*) into v_going_count
  from public.event_rsvps
  where event_id = p_event_id and status = 'going';

  v_spots_open := v_capacity - v_going_count;

  if v_spots_open <= 0 then
    return;
  end if;

  -- Promote the longest-waiting players first, up to the number of spots
  -- that just opened up.
  update public.event_rsvps
  set status = 'going'
  where id in (
    select id from public.event_rsvps
    where event_id = p_event_id and status = 'waitlist'
    order by created_at asc
    limit v_spots_open
  );
end;
$$;

-- Fires when a "going" (or waitlist) RSVP is cancelled/removed. Only a
-- departing "going" row can actually free up a spot, but calling the
-- promote function for a departing waitlist row is a harmless no-op.
create or replace function public.trg_promote_waitlist_on_rsvp_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'going' then
    perform public.promote_event_waitlist(old.event_id);
  end if;
  return old;
end;
$$;

drop trigger if exists promote_waitlist_on_rsvp_delete on public.event_rsvps;
create trigger promote_waitlist_on_rsvp_delete
after delete on public.event_rsvps
for each row
execute function public.trg_promote_waitlist_on_rsvp_delete();

-- Fires when an admin raises an event's capacity (or removes the cap).
create or replace function public.trg_promote_waitlist_on_capacity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.capacity is distinct from old.capacity
     and (new.capacity is null or new.capacity > coalesce(old.capacity, 0)) then
    perform public.promote_event_waitlist(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists promote_waitlist_on_capacity_change on public.events;
create trigger promote_waitlist_on_capacity_change
after update on public.events
for each row
execute function public.trg_promote_waitlist_on_capacity_change();
