-- Fixes an ineffective revoke from 0034_lock_down_internal_trigger_functions.sql,
-- surfaced by the security advisor while working on 0071/0072 today. 0034
-- revoked EXECUTE on these 4 internal-only functions from the `anon` and
-- `authenticated` roles directly, but never revoked it from PUBLIC — and
-- Postgres grants EXECUTE on every newly created function to PUBLIC by
-- default. Every role (including anon/authenticated) is implicitly a
-- member of PUBLIC, so that default PUBLIC grant alone was enough to keep
-- both roles able to call these functions directly via the REST RPC
-- endpoint the whole time, regardless of the explicit per-role revokes —
-- confirmed via has_function_privilege(). None of these 4 are meant to be
-- called directly by a client; they only ever run via their own triggers,
-- or (promote_event_waitlist) from inside another already-locked-down
-- function. Revoking from PUBLIC itself is what the individual-role
-- revokes could never substitute for. Trigger firing is unaffected —
-- table triggers don't check the invoking role's EXECUTE privilege on the
-- trigger function.
revoke execute on function public.promote_event_waitlist(uuid) from public;
revoke execute on function public.trg_promote_waitlist_on_capacity_change() from public;
revoke execute on function public.trg_promote_waitlist_on_rsvp_delete() from public;
revoke execute on function public.trg_send_push_on_notice_or_event() from public;
