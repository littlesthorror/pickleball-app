-- Seasons feature (2026-08-14). Unlike the monthly Top 10 / Club Player
-- snapshots, this needs no new table: ratings never reset between
-- seasons, so a past season's standings are always exactly reconstructible
-- from player_rating_as_of() + player_match_history, live, on demand.
-- Works identically for a completed season (pass its real end) or the
-- current in-progress one (pass now()).

create or replace function public.get_season_standings(p_season_start timestamptz, p_as_of timestamptz)
returns table(player_id uuid, rank bigint, rating numeric, games int, wins int, rating_gain numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    row_number() over (order by rating desc) as rank,
    rating,
    games,
    wins,
    rating_gain
  from (
    select
      p.id,
      public.player_rating_as_of(p.id, p_as_of) as rating,
      coalesce(ms.games, 0)::int as games,
      coalesce(ms.wins, 0)::int as wins,
      coalesce(ms.rating_gain, 0) as rating_gain
    from public.players p
    left join (
      select player_id, count(*) as games, count(*) filter (where won) as wins, sum(rating_delta) as rating_gain
      from public.player_match_history
      where played_at >= p_season_start and played_at <= p_as_of
      group by player_id
    ) ms on ms.player_id = p.id
    where p.is_active
      and p.profile_visible
      and (
        select count(*)
        from public.matches m
        join public.match_participant_ratings mpr on mpr.match_id = m.id
        join public.player_ratings pr on pr.player_id = mpr.player_id
        where mpr.player_id = p.id
          and m.status = 'confirmed'
          and m.played_at <= p_as_of
          and (pr.reset_at is null or m.played_at > pr.reset_at)
      ) >= 12
  ) eligible
  where rating is not null
  order by rating desc;
$$;

revoke execute on function public.get_season_standings(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_season_standings(timestamptz, timestamptz) to authenticated;
