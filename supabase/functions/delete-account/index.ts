// Supabase Edge Function — self-service "Delete my account" (GDPR right
// to erasure request, 2026-08-28). Only ever acts on the CALLER's own
// account (derived from their own auth token, never a passed-in id), so
// there's no admin-only concern here the way reset-player/delete-match
// have.
//
// Deliberately does NOT hard-delete the players row or the auth.users row.
// Every match row stores real player ids for both teams (matches.*_player_*
// foreign keys), and those are NO ACTION (not cascading) — so a real
// DELETE here would either fail outright for anyone with match history, or
// (for a brand new player with literally zero games) succeed but still be
// the wrong shape of "delete": other members' shared results, ratings, and
// badges must never be able to change just because someone else left the
// club. Instead this anonymizes the players row (name/photo/DOB/contact
// info all cleared, is_active set false) and BANS the underlying auth user
// (a long ban_duration, not a deletion) so they can't sign back in — the
// account is closed and their personal info is gone, without touching any
// shared match/rating data. See the chat explanation this mirrors for the
// full reasoning.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: callerData } = await callerClient.auth.getUser();
    const callerId = callerData?.user?.id;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "not signed in" }), { status: 401, headers: corsHeaders });
    }

    const { error: anonymizeError } = await supabase
      .from("players")
      .update({
        display_name: "Former member",
        avatar_url: null,
        date_of_birth: null,
        date_of_birth_visible: false,
        profile_visible: false,
        is_active: false,
        role_title: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
        medical_info: null,
        dark_mode: false,
        notify_new_events: false,
        notify_new_notices: false,
        notify_badge_earned: false,
        notify_rank_change: false,
      })
      .eq("id", callerId);

    if (anonymizeError) {
      return new Response(JSON.stringify({ error: anonymizeError.message }), { status: 500, headers: corsHeaders });
    }

    // Stop any further push notifications immediately, rather than leaving
    // stale subscriptions around that send-push would otherwise keep
    // trying (and cleaning up on delivery failure only).
    await supabase.from("push_subscriptions").delete().eq("player_id", callerId);

    // Ban rather than delete the auth user — deleting it would cascade to
    // the players row (players.id -> auth.users.id IS cascading) and from
    // there hit the same non-cascading match foreign keys, either failing
    // the whole request for anyone with match history or, for a brand-new
    // player, deleting the row we just deliberately kept. A very long ban
    // achieves the real goal (this login can never be used again) without
    // any of that.
    const { error: banError } = await supabase.auth.admin.updateUserById(callerId, {
      ban_duration: "876000h", // ~100 years
    });
    if (banError) {
      return new Response(
        JSON.stringify({ error: `Account data cleared, but sign-in couldn't be disabled: ${banError.message}` }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
