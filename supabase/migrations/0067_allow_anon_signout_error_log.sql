-- Widens the client_error_logs insert policy to also allow the `anon`
-- role, not just `authenticated` (2026-09-07, while investigating Ben's
-- report of members getting "logged out regularly"). App.tsx now logs a
-- diagnostic row the moment a SIGNED_OUT auth event fires unexpectedly —
-- but by the time that fires, the browser's own Supabase client has
-- already dropped its access token, so the very insert meant to capture
-- the event would go out as `anon` and get rejected by the old
-- `to authenticated` policy. player_id must be null for an anon insert
-- (there's no auth.uid() to check it against) — the previous user id is
-- still captured in the logged message text itself, so nothing is lost.
drop policy if exists "members can log their own errors" on public.client_error_logs;

create policy "members can log their own errors"
  on public.client_error_logs
  for insert
  to authenticated, anon
  with check (
    (player_id = auth.uid()) or
    (player_id is null)
  );
