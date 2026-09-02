-- Same fix as 0053_add_get_show_competitions_tab_rpc.sql, applied to the
-- new show_quarterly_cup_tab column — club_settings' only SELECT policy is
-- admin-only, so a regular member's direct select would silently return
-- nothing. A narrow security-definer function exposes just this one flag.
create or replace function public.get_show_quarterly_cup_tab()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select show_quarterly_cup_tab from public.club_settings limit 1;
$$;

grant execute on function public.get_show_quarterly_cup_tab() to authenticated;
