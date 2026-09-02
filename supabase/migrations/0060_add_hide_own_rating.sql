-- "Hide my rating number from my own dashboard" (2026-09-01, Ben's
-- request) — for anyone who doesn't want to see their own number or feels
-- negative about it. Deliberately separate from profile_visible (which
-- controls whether OTHER members can see you on the public leaderboard) —
-- this is purely about what the account owner sees on their OWN
-- dashboard. They still play, still get ranked, still show up normally to
-- everyone else; they just don't have to look at the number themselves.
alter table public.players
  add column hide_own_rating boolean not null default false;

comment on column public.players.hide_own_rating is
  'When true, the signed-in player''s OWN dashboard hides their numeric rating (hero number, delta, rating history chart, personal best) — purely a self-facing preference, does not affect profile_visible / how others see them.';
