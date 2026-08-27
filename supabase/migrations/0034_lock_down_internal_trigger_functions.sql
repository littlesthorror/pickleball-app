-- The security advisor flagged these 4 new SECURITY DEFINER functions
-- (added this session for waitlist auto-promotion and push notifications)
-- as callable directly via the public REST RPC endpoint by any signed-in
-- (or even anonymous) caller. None of them are meant to be called that
-- way — they're only ever meant to run via their triggers or from inside
-- promote_event_waitlist itself. Revoking EXECUTE from anon/authenticated
-- closes that RPC surface without affecting the triggers themselves:
-- trigger firing doesn't depend on the invoking client's grants on the
-- underlying function.
revoke execute on function public.promote_event_waitlist(uuid) from anon, authenticated;
revoke execute on function public.trg_promote_waitlist_on_capacity_change() from anon, authenticated;
revoke execute on function public.trg_promote_waitlist_on_rsvp_delete() from anon, authenticated;
revoke execute on function public.trg_send_push_on_notice_or_event() from anon, authenticated;
