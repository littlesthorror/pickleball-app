-- Optional headline/cover image for a notice — separate from the
-- attachments array, always rendered as the top banner on the redesigned
-- card (2026-08-28, matching Ben's new mockup). Same "notices" storage
-- bucket as everything else here, path convention
-- notices/<id>/cover-<ts>-<rand>.<ext>, mirroring events.poster_path.
alter table public.notices add column cover_path text;
