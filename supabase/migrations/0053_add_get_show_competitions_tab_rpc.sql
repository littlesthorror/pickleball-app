-- Bugfix (2026-08-28) — Ben reported the Competitions tab never appeared
-- for a non-admin member even after switching it on. Root cause: App.tsx
-- reads club_settings.show_competitions_tab directly for every signed-in
-- user, but club_settings' only SELECT policy (0014_invite_code_gate.sql)
-- is "only admins can read club settings" — added back when that table
-- held nothing but the admin-only invite code. When show_competitions_tab
-- was bolted onto the same table later (0035_add_competitions_schema.sql),
-- no matching read access was added for regular members, so their query
-- silently returned no row and the app defaulted the tab to hidden.
--
-- Row-level security can't expose just one column of a row to a broader
-- audience than the rest of that row (invite_code must stay admin-only) —
-- same problem redeem_invite_code() below already solved for reading
-- invite_code during sign-up. Reusing that exact pattern: a narrow
-- security-definer function any authenticated member can call, that reads
-- only the one boolean and nothing else off the row.
create or replace function public.get_show_competitions_tab()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select show_competitions_tab from public.club_settings limit 1;
$$;

grant execute on function public.get_show_competitions_tab() to authenticated;
