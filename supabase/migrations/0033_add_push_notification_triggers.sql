-- Fires the send-push edge function whenever a new notice or event is
-- created, so subscribed members get a push notification. Uses pg_net for
-- a non-blocking async HTTP call (the insert itself isn't held up waiting
-- on however long it takes to fan out pushes to everyone).
--
-- No Authorization header is sent — the send-push function is deployed
-- with verify_jwt disabled (it's a webhook-style function, only ever
-- called by this trigger, not by end users). As a safety check against the
-- public URL being spammed with arbitrary bodies, the function itself
-- re-fetches the referenced notice/event row by id using its own
-- service-role client before sending anything, rather than trusting the
-- POSTed payload directly — so the worst a stranger could do by finding
-- the URL is re-trigger notifications for a real, already-public notice or
-- event, not send arbitrary attacker-controlled text to members.
create extension if not exists pg_net;

create or replace function public.trg_send_push_on_notice_or_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://trfkgonjyonystitgeli.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'id', new.id
    ),
    timeout_milliseconds := 8000
  );
  return new;
end;
$$;

drop trigger if exists send_push_on_notice_insert on public.notices;
create trigger send_push_on_notice_insert
after insert on public.notices
for each row
execute function public.trg_send_push_on_notice_or_event();

drop trigger if exists send_push_on_event_insert on public.events;
create trigger send_push_on_event_insert
after insert on public.events
for each row
execute function public.trg_send_push_on_notice_or_event();
