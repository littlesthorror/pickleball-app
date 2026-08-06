-- Admin-editable FAQ. Anyone signed in can read; only admins can write.
create table public.faq_items (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  sort_order int not null default 0,
  created_by uuid references public.players (id),
  created_at timestamptz not null default now()
);

alter table public.faq_items enable row level security;

create policy "faq readable by any logged-in member"
  on public.faq_items for select
  using (auth.role() = 'authenticated');

create policy "only admins can create faq items"
  on public.faq_items for insert
  with check (public.is_admin());

create policy "only admins can update faq items"
  on public.faq_items for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "only admins can delete faq items"
  on public.faq_items for delete
  using (public.is_admin());
