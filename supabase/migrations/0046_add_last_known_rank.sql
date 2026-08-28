alter table public.players
  add column last_known_rank int;

comment on column public.players.last_known_rank is
  'Overall leaderboard rank as of the last time notify-post-match checked it — purely internal bookkeeping so a rank-change push only fires on the game that actually crosses the Top 10 boundary, not every game. Added 2026-08-28.';
