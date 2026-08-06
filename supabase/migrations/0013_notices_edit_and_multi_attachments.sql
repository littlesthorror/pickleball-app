-- Allow admins to edit existing notices (previously only insert/delete were
-- permitted — fixing a typo required deleting and reposting).
create policy "only admins can update notices"
  on public.notices for update
  using (public.is_admin())
  with check (public.is_admin());

-- Support multiple attachments per notice, stored as an array of
-- {path, name} objects. The old single-attachment file_path/file_name
-- columns are kept (unused going forward) so no data is lost, and existing
-- notices are backfilled into the new column.
alter table public.notices add column attachments jsonb not null default '[]'::jsonb;

update public.notices
set attachments = jsonb_build_array(jsonb_build_object('path', file_path, 'name', file_name))
where file_path is not null;
