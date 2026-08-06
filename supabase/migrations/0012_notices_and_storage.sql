-- Admin notice board: short notes and/or an attached file (e.g. team
-- sheets). Anyone signed in can read; only admins can post/delete.
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  file_path text,
  file_name text,
  created_by uuid references public.players (id),
  created_at timestamptz not null default now()
);

alter table public.notices enable row level security;

create policy "notices readable by any logged-in member"
  on public.notices for select
  using (auth.role() = 'authenticated');

create policy "only admins can create notices"
  on public.notices for insert
  with check (public.is_admin());

create policy "only admins can delete notices"
  on public.notices for delete
  using (public.is_admin());

-- Storage bucket for notice attachments — public bucket (same pattern as
-- avatars), but only admins can write to it. Files live under a random
-- prefix so they're not guessable/listable by casual browsing.
insert into storage.buckets (id, name, public)
values ('notices', 'notices', true)
on conflict (id) do nothing;

create policy "notice files readable by anyone with the link"
  on storage.objects for select
  using (bucket_id = 'notices');

create policy "only admins can upload notice files"
  on storage.objects for insert
  with check (bucket_id = 'notices' and public.is_admin());

create policy "only admins can delete notice files"
  on storage.objects for delete
  using (bucket_id = 'notices' and public.is_admin());
