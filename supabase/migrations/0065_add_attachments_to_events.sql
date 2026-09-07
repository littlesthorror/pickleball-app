-- Adds file/photo attachments to events (2026-09-07, Ben's request) — same
-- shape as notices.attachments (added in 0013_notices_edit_and_multi_attachments.sql):
-- a jsonb array of {path, name} objects, stored in the same "notices"
-- storage bucket events already reuse for poster images (see poster_path's
-- own comment on the events table). Purely additive, defaults to an empty
-- array so every existing event keeps working unchanged.

alter table public.events add column attachments jsonb not null default '[]'::jsonb;
