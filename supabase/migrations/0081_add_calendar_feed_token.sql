-- Club-wide calendar subscription feed (2026-11-02, Ben's request).
-- The calendar-feed edge function serves public (non-private) events as an
-- .ics feed at a URL containing this secret token, because calendar apps
-- can't sign in. The token lives on the club_settings singleton row, whose
-- direct SELECT is admin-only (see 0014), so members read it through a
-- narrow security-definer RPC instead (same pattern as
-- get_show_competitions_tab). Admins can rotate it if the link ever leaks.
alter table public.club_settings
  add column if not exists calendar_feed_token text;

update public.club_settings
set calendar_feed_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where calendar_feed_token is null;

create or replace function public.get_calendar_feed_token()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select calendar_feed_token from public.club_settings limit 1;
$$;

revoke all on function public.get_calendar_feed_token() from public, anon;
grant execute on function public.get_calendar_feed_token() to authenticated;

create or replace function public.rotate_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_token text;
begin
  if not is_admin() then
    raise exception 'admins only';
  end if;
  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.club_settings set calendar_feed_token = new_token where true;
  return new_token;
end;
$$;

revoke all on function public.rotate_calendar_feed_token() from public, anon;
grant execute on function public.rotate_calendar_feed_token() to authenticated;
