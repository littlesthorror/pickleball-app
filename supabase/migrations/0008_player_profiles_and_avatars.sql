-- Player profile fields (name is already on `players`; this adds the rest
-- of what the profile screen needs) plus a Storage bucket for avatar
-- photos.
alter table public.players add column date_of_birth date;
alter table public.players add column date_of_birth_visible boolean not null default false;
alter table public.players add column avatar_url text;
alter table public.players add column profile_completed boolean not null default false;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar files readable by anyone with the link"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "players can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "players can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "players can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop view if exists public.leaderboard;
drop view if exists public.player_status;

create view public.player_status as
select
  p.id,
  p.display_name,
  p.date_joined,
  p.is_admin,
  p.is_active,
  p.avatar_url,
  p.date_of_birth,
  p.date_of_birth_visible,
  p.profile_completed,
  pr.rating,
  pr.rd,
  pr.games_played,
  pr.reset_at,
  (pr.games_played < 12) as is_provisional
from public.players p
join public.player_ratings pr on pr.player_id = p.id;

create view public.leaderboard as
select
  ps.*,
  (ps.rating - public.player_rating_as_of(ps.id, now() - interval '30 days')) as delta_30d
from public.player_status ps;
