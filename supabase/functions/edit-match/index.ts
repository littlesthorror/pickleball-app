// Supabase Edge Function — admin-only. Lets an admin correct a
// mis-entered score on an existing match. Added 2026-08-11 ("are we able
// to have an edit button to edit the score if it was entered
// incorrectly").
//
// A PENDING (or disputed) match never had ratings applied — confirm-match
// only runs once, at submit time — so its score can just be updated
// directly, no recompute needed.
//
// A CONFIRMED match already had its original score run through Glicko-2,
// and everything played after it was computed on top of that result.
// Same as delete-match: rather than trying to patch just this one game's
// rating delta, the score gets updated and then the ENTIRE confirmed
// match history is replayed from scratch via recomputeAllRatings (see
// replay.ts) — so the corrected score's effect on every game after it,
// for every player it touched (not just these four), is captured
// properly.
//
// Call with { match_id, team_a_score, team_b_score }.

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

    const { match_id, team_a_score, team_b_score } = await req.json();

    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), { status: 400, headers: corsHeaders });
    }
    if (
      !Number.isInteger(team_a_score) ||
      !Number.isInteger(team_b_score) ||
      team_a_score < 0 ||
      team_b_score < 0
    ) {
      return new Response(
        JSON.stringify({ error: "scores must be whole numbers, zero or higher" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Neither of these needs the other's result, so they run together
    // instead of one after another.
    const [{ data: callerData }, { data: match, error: matchError }] = await Promise.all([
      callerClient.auth.getUser(),
      supabase.from("matches").select("id, status").eq("id", match_id).single(),
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

    const { error: updateError } = await supabase
      .from("matches")
      .update({ team_a_score, team_b_score })
      .eq("id", match_id);
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers: corsHeaders });
    }

    if (match.status !== "confirmed") {
      // No rating changes were ever applied for this match — the new
      // score will simply be used whenever it does get confirmed.
      return new Response(JSON.stringify({ ok: true, recomputed: false }), { status: 200, headers: corsHeaders });
    }

    const result = await recomputeAllRatings(supabase);
    if (!result.ok) {
      // The score itself is already saved at this point — surface this
      // clearly rather than pretending it's a normal save failure, since
      // ratings may now be out of sync with the corrected score until
      // recompute is retried (e.g. via the standalone "Recompute history"
      // button).
      return new Response(
        JSON.stringify({
          error: `Score updated, but recalculating ratings afterward failed: ${result.error}. Use "Recompute history" on the Admins page to fix this.`,
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true, recomputed: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
