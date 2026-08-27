-- Tracks when a player last opened the Notices / Events tabs, so the nav
-- bar can show a small "new" indicator when something's been posted since
-- their last visit. Nullable: null just means "never visited", which
-- should show as new if any notice/event exists at all.
alter table public.players
  add column last_seen_notices_at timestamptz,
  add column last_seen_events_at timestamptz;
