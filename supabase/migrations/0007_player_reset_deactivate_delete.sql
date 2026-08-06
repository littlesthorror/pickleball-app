-- Adds the three admin-lifecycle actions for a player account:
--   - deactivate (is_active = false): hides them from match entry without
--     touching any data — reversible any time.
--   - soft reset (reset_at timestamp): rolls a player's own rating back to
--     a fresh start WITHOUT touching historical match rows, so everyone
--     else's shared match history against them stays exactly as it was.
--     player_match_history / player_rating_as_of are updated below to
--     ignore anything before a player's own reset_at.
--   - delete: relies entirely on the existing foreign-key constraints on
--     matches/match_participant_ratings (no cascade) — a player with any
--     match history simply can't be deleted at the database level, which
--     is the real safety net, not an application-level check.
alter table public.players add column is_active boolean not null default true;
alter table public.player_ratings add column reset_at timestamptz;

drop view if exists public.leaderboard;
drop view if exists public.player_status;

create view public.player_status as
select
  p.id,
  p.display_name,
  p.date_joined,
  p.is_admin,
  p.is_active,
  pr.rating,
  pr.rd,
  pr.games_played,
  pr.reset_at,
  (pr.games_played < 12) as is_provisional
from public.players p
join public.player_ratings pr on pr.player_id = p.id;

create view public.leaderboard as
select
  ps.*,
  (ps.rating - public.player_rating_as_of(ps.id, now() - interval '30 days')) as delta_30d
from public.player_status ps;

create or replace view public.player_match_history as
select
  mpr.player_id,
  m.id as match_id,
  m.played_at,
  mpr.team,
  mpr.pre_rating,
  mpr.pre_rd,
  mpr.post_rating,
  mpr.post_rd,
  (mpr.post_rating - mpr.pre_rating) as rating_delta,
  case when mpr.team = 'a' then m.team_a_score else m.team_b_score end as own_score,
  case when mpr.team = 'a' then m.team_b_score else m.team_a_score end as opponent_score,
  (case when mpr.team = 'a' then m.team_a_score else m.team_b_score end)
    > (case when mpr.team = 'a' then m.team_b_score else m.team_a_score end) as won,
  case when mpr.team = 'a'
    then (select display_name from public.players where id =
      case when m.team_a_player_1_id = mpr.player_id then m.team_a_player_2_id else m.team_a_player_1_id end)
    else (select display_name from public.players where id =
      case when m.team_b_player_1_id = mpr.player_id then m.team_b_player_2_id else m.team_b_player_1_id end)
  end as teammate_name,
  case when mpr.team = 'a'
    then (select string_agg(display_name, ' / ') from public.players where id in (m.team_b_player_1_id, m.team_b_player_2_id))
    else (select string_agg(display_name, ' / ') from public.players where id in (m.team_a_player_1_id, m.team_a_player_2_id))
  end as opponent_names,
  row_number() over (partition by mpr.player_id order by m.played_at) as game_number
from public.match_participant_ratings mpr
join public.matches m on m.id = mpr.match_id
join public.player_ratings pr on pr.player_id = mpr.player_id
where m.status = 'confirmed'
  and (pr.reset_at is null or m.played_at > pr.reset_at);

create or replace function public.player_rating_as_of(p_player_id uuid, p_as_of timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(
    (
      select mpr.post_rating
      from public.match_participant_ratings mpr
      join public.matches m on m.id = mpr.match_id
      join public.player_ratings pr on pr.player_id = mpr.player_id
      where mpr.player_id = p_player_id
        and m.status = 'confirmed'
        and m.played_at <= p_as_of
        and (pr.reset_at is null or m.played_at > pr.reset_at)
      order by m.played_at desc
      limit 1
    ),
    case when (select date_joined from public.players where id = p_player_id) <= p_as_of
      then 1500
      else null
    end
  );
$$;

create policy "admins can delete a player"
  on public.players for delete
  using (public.is_admin());
