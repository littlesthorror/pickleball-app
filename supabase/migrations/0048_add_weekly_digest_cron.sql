-- Weekly digest push ("this week at Sideline") — Sunday 9:30pm local
-- (Europe/London) time. pg_cron always runs in UTC and has no idea about
-- BST/GMT, so rather than trying to keep a UTC cron expression in sync
-- with the clock twice a year, this ticks every 15 minutes year-round and
-- lets the weekly-digest edge function itself work out the real London
-- time via JS Intl and decide whether it's actually the right moment to
-- send — the DST-safe part lives in application code, not the cron
-- expression. club_settings.last_weekly_digest_sent_at is the guard against
-- sending more than once if the tick lands in the send window twice (e.g.
-- a slow run) or the function is invoked manually while testing.

create extension if not exists pg_cron;

alter table public.club_settings
  add column last_weekly_digest_sent_at timestamptz;

select cron.schedule(
  'weekly-digest-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://trfkgonjyonystitgeli.supabase.co/functions/v1/weekly-digest',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
