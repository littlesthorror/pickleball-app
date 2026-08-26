// Supabase Edge Function — lets an admin delete a mis-entered match from
// Game history. Added 2026-08-10, upgraded the same day to allow deleting
// ANY confirmed match, not just each player's most recent one.
//
// A CONFIRMED match already wrote real rating changes for all four
// players via confirm-match, and every game after it in the club's
// history was computed on top of that. Simply deleting the matches row
// would leave those downstream calculations silently wrong. Rather than
// refuse to delete an older game (the original version of this
// function), it now deletes the match and then rebuilds every player's
// rating from the complete remaining history via recomputeAllRatings
// (see replay.ts) — which correctly removes the deleted game's effect on
// everything that came after it, for every player it touched, not just
// the four in this match.
//
// A PENDING (or disputed) match never had ratings applied in the first
// place — confirm-match only writes rating changes once it succeeds — so
// those still just delete directly with no recompute needed.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { recomputeAllRatings } from "./replay.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Added 2026-08-27 — see confirm-match/index.ts for the full note on why
// this was added to every browser-called function (missing CORS/OPTIONS
// handling, flagged by Supabase support).
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

    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), { status: 400, headers: corsHeaders });
    }

    // Neither of these needs the other's result, so they run together
    // instead of one after another.
    const [{ data: callerData }, { data: match, error: matchError }] = await Promise.all([
      callerClient.auth.getUser(),
      supabase.from("matches").select("*").eq("id", match_id).single(),
    ]);

    const callerId = callerData?.user?.id;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "not signed in" }), { status: 401, headers: corsHeaders });
    }
    const { data: callerPlayer } = await supabase
      .from("players")
      .select("is_admin")
      .eq("id", callerId)
      .single();
    if (!callerPlayer?.is_admin) {
      return new Response(JSON.stringify({ error: "admins only" }), { status: 403, headers: corsHeaders });
    }

    if (matchError || !match) {
      return new Response(JSON.stringify({ error: "match not found" }), { status: 404, headers: corsHeaders });
    }

    if (match.status !== "confirmed") {
      // No rating changes were ever applied for this match — safe to just
      // remove it outright, no recompute needed.
      const { error: deleteError } = await supabase.from("matches").delete().eq("id", match_id);
      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ ok: true, recomputed: false }), { status: 200, headers: corsHeaders });
    }

    const { error: deleteError } = await supabase.from("matches").delete().eq("id", match_id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: corsHeaders });
    }

    const result = await recomputeAllRatings(supabase);
    if (!result.ok) {
      // The match itself is already gone at this point — surface this
      // clearly rather than pretending it's a normal delete failure,
      // since ratings may now be out of sync until recompute is retried
      // (e.g. via the standalone "Recompute history" button).
      return new Response(
        JSON.stringify({
          error: `Game deleted, but recalculating ratings afterward failed: ${result.error}. Use "Recompute history" on the Admins page to fix this.`,
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true, recomputed: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
