-- Notices "last updated" timestamp (2026-08-28) — Ben's request: a subtle
-- date/time note showing when a notice was last edited, not just when it
-- was first posted. Implemented as a DB trigger rather than remembering to
-- set it in every client-side update path (edit save, cover image
-- swap/remove, pin/unpin) — same reasoning as the existing push-notification
-- triggers: correctness belongs at the data layer, not scattered across
-- every call site that can touch the row.
alter table public.notices
  add column updated_at timestamptz not null default now();

comment on column public.notices.updated_at is
  'Auto-maintained by set_notices_updated_at() below — bumped on any UPDATE. Starts equal to created_at for existing rows.';

update public.notices set updated_at = created_at;

create or replace function public.set_notices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notices_set_updated_at
  before update on public.notices
  for each row
  execute function public.set_notices_updated_at();
