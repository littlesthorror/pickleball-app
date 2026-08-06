-- Powers the individual dashboard: one row per confirmed match a player
-- took part in, with a per-player sequential game number ("games since
-- joining"), opponent/teammate names, score, win/loss, and rating delta.
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
where m.status = 'confirmed';

-- Powers the leaderboard's "30-day delta" and "most improved" sort: a
-- player's rating as it stood at (or just before) a given point in time.
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
      where mpr.player_id = p_player_id
        and m.status = 'confirmed'
        and m.played_at <= p_as_of
      order by m.played_at desc
      limit 1
    ),
    case when (select date_joined from public.players where id = p_player_id) <= p_as_of
      then 1500
      else null
    end
  );
$$;

-- player_status + 30-day rating change. NULL delta means the player joined
-- less than 30 days ago (no meaningful "30 days ago" rating to compare to).
create or replace view public.leaderboard as
select
  ps.*,
  (ps.rating - public.player_rating_as_of(ps.id, now() - interval '30 days')) as delta_30d
from public.player_status ps;
