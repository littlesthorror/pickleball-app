-- Admin-visible client error logging. Captures uncaught JS errors and
-- unhandled promise rejections from any signed-in member's browser so
-- admins can spot real bugs (e.g. the Android Google-Drive-attachment
-- issue) without relying on someone remembering to describe it accurately.
-- Any authenticated member can insert (their own errors only, enforced by
-- the insert policy's check matching auth.uid()), but only admins can read
-- or clear them.

create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_id uuid references public.players(id) on delete set null,
  message text not null,
  stack text,
  source text, -- "window.onerror" | "unhandledrejection" | "react-error-boundary" etc.
  page_path text,
  user_agent text
);

create index if not exists client_error_logs_created_at_idx on public.client_error_logs (created_at desc);

alter table public.client_error_logs enable row level security;

create policy "members can log their own errors"
  on public.client_error_logs
  for insert
  to authenticated
  with check (player_id = auth.uid() or player_id is null);

create policy "admins can view error logs"
  on public.client_error_logs
  for select
  to authenticated
  using (is_admin());

create policy "admins can clear error logs"
  on public.client_error_logs
  for delete
  to authenticated
  using (is_admin());
