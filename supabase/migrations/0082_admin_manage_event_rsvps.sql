-- Admins can add/remove event attendees on behalf of members (2026-11-13,
-- Ben's request: "edit attendees of an Event without them manually removing
-- themselves"). Until now event_rsvps only allowed a player to insert/update/
-- delete their OWN row. Deleting an admin-removed row still fires the existing
-- waitlist auto-promotion trigger (0030/0071), so removing someone frees their
-- spot for the next person on the waitlist exactly as a self-cancel does.

create policy "admins can add rsvps for anyone"
  on public.event_rsvps for insert
  to authenticated
  with check (is_admin());

create policy "admins can change any rsvp"
  on public.event_rsvps for update
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "admins can remove any rsvp"
  on public.event_rsvps for delete
  to authenticated
  using (is_admin());
