-- Lets an admin pin a notice to the top of the board. Applied directly to
-- the live project on 2026-08-27 (remote migration
-- 20260827094904_notices_pinned_flag) — added here so the local repo
-- matches what's actually deployed.
alter table public.notices add column pinned boolean not null default false;
