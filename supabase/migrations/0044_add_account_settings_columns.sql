-- My Account additions (2026-08-28): emergency contact (admin-visible
-- only), dark mode preference (synced across devices via the account
-- rather than per-device localStorage), and granular push notification
-- categories replacing the previous single on/off toggle.
alter table public.players
  add column emergency_contact_name text,
  add column emergency_contact_phone text,
  add column dark_mode boolean not null default false,
  add column notify_new_events boolean not null default true,
  add column notify_new_notices boolean not null default true,
  add column notify_badge_earned boolean not null default true,
  add column notify_rank_change boolean not null default true;

comment on column public.players.emergency_contact_name is 'Optional emergency contact name, set by the player themselves. Visible only to admins (see AdminManagement) — never shown to other regular members.';
comment on column public.players.emergency_contact_phone is 'Optional emergency contact phone number, same visibility as emergency_contact_name.';
comment on column public.players.dark_mode is 'Dark theme preference, synced across devices since it lives on the account rather than in browser storage.';
comment on column public.players.notify_new_events is 'Push notification category toggle: new events posted.';
comment on column public.players.notify_new_notices is 'Push notification category toggle: new notices posted.';
comment on column public.players.notify_badge_earned is 'Push notification category toggle: earning a new badge.';
comment on column public.players.notify_rank_change is 'Push notification category toggle: entering/exiting the club Top 10.';
