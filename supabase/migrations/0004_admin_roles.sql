-- Adds an admin/player role split:
--   - admins (you, Dan) can enter match scores; matches they submit finalize
--     immediately (no separate confirmation step — you're both already
--     trusted to enter results, per the club's existing process).
--   - everyone else is view-only.
-- An admin-management screen lets an existing admin promote/demote other
-- players; the trigger below stops anyone else from self-promoting by
-- editing their own row directly.

alter table public.players add column is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.players where id = auth.uid()), false);
$$;

create or replace function public.prevent_self_admin_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_admin is distinct from OLD.is_admin and not public.is_admin() then
    NEW.is_admin := OLD.is_admin;
  end if;
  return NEW;
end;
$$;

drop trigger if exists prevent_self_admin_promotion on public.players;
create trigger prevent_self_admin_promotion
  before update on public.players
  for each row execute function public.prevent_self_admin_promotion();

create policy "admins can update any player"
  on public.players for update
  using (public.is_admin())
  with check (public.is_admin());

-- Only admins can submit matches now (was: any player who took part).
drop policy if exists "any member can submit a match" on public.matches;
create policy "only admins can submit a match"
  on public.matches for insert
  with check (auth.uid() = submitted_by and public.is_admin());

-- The old peer-confirmation update policy was also overly permissive (any
-- authenticated user could update any pending match). No longer needed —
-- admin-submitted matches are finalized by the confirm-match edge function
-- using the service role key, which bypasses RLS entirely.
drop policy if exists "confirming member can update a pending match" on public.matches;

-- One-time bootstrap note: the very first admin has to be set directly in
-- the database (there's no admin yet to use the admin screen!). This was
-- done manually for Ben Franklin on 2026-08-04. Not repeated here since
-- migrations shouldn't hardcode a specific person.
