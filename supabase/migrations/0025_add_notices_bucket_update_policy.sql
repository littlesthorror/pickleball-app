-- The "notices" storage bucket (reused by event posters under an
-- events/ prefix) had INSERT/DELETE/SELECT policies for admins but no
-- UPDATE policy. Replacing an existing file at the same storage path
-- (e.g. re-uploading an event poster, which Events.tsx does with
-- { upsert: true }) performs an UPDATE on storage.objects under the
-- hood, not a fresh INSERT — which RLS was silently blocking with "new
-- row violates row-level security policy". Mirrors the existing
-- "players can replace their own avatar" UPDATE policy on the avatars
-- bucket, just admin-gated instead of own-folder-gated.

create policy "admins can replace notice files"
  on storage.objects for update
  using (bucket_id = 'notices' and is_admin());
