-- Gate new sign-ups behind a club invite code, so a random Google account
-- can no longer get a player profile just by visiting the app's URL.
-- Previously the on_auth_user_created trigger created a players row for
-- anyone the moment they signed in with Google. That's replaced here by an
-- explicit redeem_invite_code() RPC the client calls after sign-in, before
-- a player row exists.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- Single-row settings table holding the club's current invite code. The
-- "id boolean primary key default true, check (id)" pattern guarantees
-- there can only ever be exactly one row.
create table public.club_settings (
  id boolean primary key default true,
  invite_code text not null,
  updated_at timestamptz not null default now(),
  constraint club_settings_singleton check (id)
);

alter table public.club_settings enable row level security;

create policy "only admins can read club settings"
  on public.club_settings for select
  using (public.is_admin());

create policy "only admins can update club settings"
  on public.club_settings for update
  using (public.is_admin())
  with check (public.is_admin());

-- Seed with a random default code — visible/changeable by any admin via the
-- new "Invite code" section on the Admins screen.
insert into public.club_settings (invite_code)
values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));

-- Runs as the table owner (security definer) so it can read the invite
-- code and insert the new player row even though the caller isn't a member
-- yet and has no RLS access to either. Trimmed/case-insensitive comparison
-- so a stray space or lowercase typo doesn't block a legitimate new member.
create or replace function public.redeem_invite_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  already_member boolean;
  code_matches boolean;
begin
  select exists (select 1 from public.players where id = auth.uid()) into already_member;
  if already_member then
    return true;
  end if;

  select (upper(trim(invite_code)) = upper(trim(input_code)))
  into code_matches
  from public.club_settings
  limit 1;

  if not coalesce(code_matches, false) then
    return false;
  end if;

  insert into public.players (id, display_name)
  select au.id, coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', au.email)
  from auth.users au
  where au.id = auth.uid();

  insert into public.player_ratings (player_id) values (auth.uid());

  return true;
end;
$$;

grant execute on function public.redeem_invite_code(text) to authenticated;
