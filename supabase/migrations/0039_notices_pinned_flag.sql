-- Lets an admin pin a notice to the top of the board.
alter table public.notices add column pinned boolean not null default false;
