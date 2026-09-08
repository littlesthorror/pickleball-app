-- Lets an admin make a notice's banner a YouTube video (a tap-to-play
-- thumbnail using the same video lightbox already used for YouTube links
-- pasted in a notice's body) instead of an uploaded photo. Mutually
-- exclusive with cover_path — the app only ever sets one of the two, never
-- both, but both are nullable so either/neither can be set. Requested by
-- Ben on 2026-09-08 for posting event highlight clips as the headline of a
-- notice.
alter table public.notices
  add column cover_video_id text null;
