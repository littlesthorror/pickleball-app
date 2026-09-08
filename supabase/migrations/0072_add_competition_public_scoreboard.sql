-- Public, no-login live scoreboard for competitions (2026-09-08, Ben's
-- request) — a shareable link + QR code an admin can print and stick up
-- at the courts so spectators can follow live standings/bracket on their
-- phones without an account.
--
-- public_share_token is null (feature off) until an admin explicitly
-- turns it on for that competition; a fresh random token is generated
-- client-side (crypto.randomUUID(), same unguessable-path pattern already
-- used for storage uploads elsewhere in this app) each time it's enabled,
-- so an old printed QR code stops working the moment an admin disables/
-- re-enables it.
alter table public.competitions
  add column public_share_token text unique;

-- Read-only, SECURITY DEFINER — deliberately narrow rather than granting
-- anon a broad RLS SELECT policy on the underlying tables: only returns
-- data for the one competition whose CURRENT token matches, and only the
-- fields a spectator scoreboard actually needs (team/player display
-- names, scores, bracket structure — no ids beyond what's needed to join
-- client-side, no admin-only data). Every other SECURITY DEFINER function
-- in this app deliberately revokes anon/authenticated execute (see the
-- comment in 0034) — this one is the intentional, narrowly-scoped
-- exception: it's read-only, and returns nothing at all without a live
-- token to look up.
create or replace function public.get_public_competition_scoreboard(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'competition', jsonb_build_object(
      'name', comp.name,
      'event_date', comp.event_date,
      'status', comp.status,
      'scoring_system', comp.scoring_system
    ),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ct.id,
        'team_name', ct.team_name,
        'player1_name', p1.display_name,
        'player2_name', p2.display_name
      )), '[]'::jsonb)
      from public.competition_teams ct
      join public.players p1 on p1.id = ct.player1_id
      join public.players p2 on p2.id = ct.player2_id
      where ct.competition_id = comp.id
    ),
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'sort_order', g.sort_order,
        'team_ids', (
          select coalesce(jsonb_agg(cgt.team_id), '[]'::jsonb)
          from public.competition_group_teams cgt
          where cgt.group_id = g.id
        )
      ) order by g.sort_order), '[]'::jsonb)
      from public.competition_groups g
      where g.competition_id = comp.id
    ),
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cm.id,
        'group_id', cm.group_id,
        'knockout_round', cm.knockout_round,
        'knockout_slot', cm.knockout_slot,
        'team_a_id', cm.team_a_id,
        'team_b_id', cm.team_b_id,
        'winner_team_id', cm.winner_team_id,
        'team_a_score', m.team_a_score,
        'team_b_score', m.team_b_score
      )), '[]'::jsonb)
      from public.competition_matches cm
      left join public.matches m on m.id = cm.match_id
      where cm.competition_id = comp.id
    )
  )
  from public.competitions comp
  where comp.public_share_token = p_token
$$;

grant execute on function public.get_public_competition_scoreboard(text) to anon, authenticated;
