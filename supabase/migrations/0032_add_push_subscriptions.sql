-- Web push subscriptions (2026-08-25). Each row is one browser/device's
-- push endpoint for one member — a member can have several (phone + laptop
-- etc.), hence the (player_id, endpoint) uniqueness rather than one row per
-- player. RLS lets a member fully manage only their own rows; the
-- send-push edge function reads across everyone's rows using its
-- service-role client, which bypasses RLS as usual.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (player_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "members manage their own push subscriptions"
  on public.push_subscriptions
  for all
  to authenticated
  using (player_id = auth.uid())
  with check (player_id = auth.uid());
