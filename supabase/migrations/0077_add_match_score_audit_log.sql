-- Match score audit log (2026-09-24, Ben's request after a rating
-- discrepancy he reported turned out to trace back to an admin's score
-- correction that afternoon — investigating it required digging through
-- raw Supabase infrastructure logs, and even then the specific match and
-- old/new scores couldn't be recovered, since edit-match/delete-match
-- simply overwrite or remove the row with no history kept anywhere.
--
-- This table gives edit-match and delete-match somewhere to record what
-- actually happened, in-app, answerable directly rather than needing a
-- log-diving investigation next time. Player ids and played_at are
-- denormalized (copied at the time of the action) rather than joined
-- live, because delete-match actually removes the matches row — by the
-- time anyone reads this log, the original match may no longer exist to
-- join against.
--
-- Written only by the edit-match/delete-match edge functions via the
-- service-role key (which bypasses RLS entirely), so there's no insert
-- policy for regular members — this table is never client-writable.
-- Deliberately no delete/update policy either, even for admins: an audit
-- log that can be edited or cleared through the same app it's meant to
-- catch problems in isn't much of an audit log.

create table if not exists public.match_score_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('edit_score', 'delete')),
  match_id uuid not null,
  played_at timestamptz not null,
  team_a_player_1_id uuid references public.players(id) on delete set null,
  team_a_player_2_id uuid references public.players(id) on delete set null,
  team_b_player_1_id uuid references public.players(id) on delete set null,
  team_b_player_2_id uuid references public.players(id) on delete set null,
  old_team_a_score integer not null,
  old_team_b_score integer not null,
  -- Null for a delete — there's no "new score", the match is just gone.
  new_team_a_score integer,
  new_team_b_score integer,
  performed_by uuid references public.players(id) on delete set null,
  performed_at timestamptz not null default now()
);

create index if not exists match_score_audit_log_performed_at_idx
  on public.match_score_audit_log (performed_at desc);

alter table public.match_score_audit_log enable row level security;

create policy "admins can view match audit log"
  on public.match_score_audit_log
  for select
  to authenticated
  using (is_admin());
