-- Raises the Club Player of the Month monthly snapshot's minimum games
-- threshold from 3 to 12, to match the live Leaderboard.tsx calculation
-- (MIN_GAMES_FOR_CLUB_PLAYER, changed 2026-08-14 at Ben's request — their
-- club plays ~8 games/session with some players doing multiple sessions a
-- week, so 12 games this month is a realistic bar).

create or replace function public.snapshot_month_end_leaderboard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_month_start timestamptz := date_trunc('month', now()) - interval '1 month';
  v_prev_month_end timestamptz := date_trunc('month', now()) - interval '1 second';
  v_year_month text := to_char(v_prev_month_start, 'YYYY-MM');
begin
  -- Nothing to do yet in the site's first calendar month.
  if v_year_month < to_char((select min(date_joined) from public.players), 'YYYY-MM') then
    return;
  end if;

  -- Top 10 leaderboard snapshot (powers the Top 10 / Top 3 badges).
  if not exists (select 1 from public.monthly_leaderboard_snapshots where year_month = v_year_month) then
    insert into public.monthly_leaderboard_snapshots (year_month, player_id, rank, rating)
    select v_year_month, id, row_number() over (order by rating desc), rating
    from (
      select p.id, public.player_rating_as_of(p.id, v_prev_month_end) as rating
      from public.players p
      where p.is_active
        and p.profile_visible
        and (
          select count(*)
          from public.matches m
          join public.match_participant_ratings mpr on mpr.match_id = m.id
          join public.player_ratings pr on pr.player_id = mpr.player_id
          where mpr.player_id = p.id
            and m.status = 'confirmed'
            and m.played_at <= v_prev_month_end
            and (pr.reset_at is null or m.played_at > pr.reset_at)
        ) >= 12
    ) eligible
    where rating is not null
    order by rating desc
    limit 10;
  end if;

  -- Club Player of the Month award — same blend of activity (games),
  -- reliability (win %), and improvement (rating gained) as the live
  -- version on the Leaderboard page, just computed once for the month
  -- that just finished instead of live every page load. Requires 12+
  -- games this month, same as the live calculation.
  if not exists (select 1 from public.monthly_club_player_awards where year_month = v_year_month) then
    insert into public.monthly_club_player_awards (year_month, player_id, games, wins, win_pct, rating_gain)
    select v_year_month, player_id, games, wins, win_pct, rating_gain
    from (
      select
        ms.player_id,
        ms.games,
        ms.wins,
        (ms.wins::numeric / ms.games) as win_pct,
        ms.rating_gain,
        (
          coalesce(ms.games::numeric / nullif(max(ms.games) over (), 0), 0)
          + coalesce((ms.wins::numeric / ms.games), 0)
          + coalesce(greatest(ms.rating_gain, 0) / nullif(max(greatest(ms.rating_gain, 0)) over (), 0), 0)
        ) / 3 as composite
      from (
        select
          pmh.player_id,
          count(*) as games,
          count(*) filter (where pmh.won) as wins,
          sum(pmh.rating_delta) as rating_gain
        from public.player_match_history pmh
        join public.players p on p.id = pmh.player_id
        where pmh.played_at >= v_prev_month_start
          and pmh.played_at <= v_prev_month_end
          and p.is_active
          and p.profile_visible
        group by pmh.player_id
      ) ms
      where ms.games >= 12
    ) scored
    order by composite desc
    limit 1;
  end if;
end;
$$;

revoke execute on function public.snapshot_month_end_leaderboard() from public, anon;
grant execute on function public.snapshot_month_end_leaderboard() to authenticated;
