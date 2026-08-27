-- Forward-only month-end leaderboard snapshots, used to power the new
-- "Top 10" / "Top 3" badges. No backfill for months before this shipped —
-- every player effectively starts fresh, per Ben's explicit call
-- (2026-08-14). Snapshotting is lazy (no cron/scheduled job in this
-- project): any signed-in client can call snapshot_month_end_leaderboard(),
-- which is a cheap no-op unless the most recently completed calendar month
-- hasn't been recorded yet. Leaderboard.tsx calls it once on page load.

create table public.monthly_leaderboard_snapshots (
  year_month text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  rank int not null,
  rating numeric not null,
  created_at timestamptz not null default now(),
  primary key (year_month, player_id)
);

alter table public.monthly_leaderboard_snapshots enable row level security;

create policy "monthly snapshots readable by any logged-in member"
  on public.monthly_leaderboard_snapshots for select
  using (auth.role() = 'authenticated');

-- No direct client insert/update policies — all writes go through the
-- security definer function below, same pattern as apply_recompute_results.

create or replace function public.snapshot_month_end_leaderboard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_month_end timestamptz := date_trunc('month', now()) - interval '1 second';
  v_year_month text := to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM');
begin
  -- Nothing to do yet in the site's first calendar month, or if this
  -- month has already been snapshotted.
  if v_year_month < to_char((select min(date_joined) from public.players), 'YYYY-MM') then
    return;
  end if;

  if exists (select 1 from public.monthly_leaderboard_snapshots where year_month = v_year_month) then
    return;
  end if;

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
end;
$$;

revoke execute on function public.snapshot_month_end_leaderboard() from public, anon;
grant execute on function public.snapshot_month_end_leaderboard() to authenticated;
