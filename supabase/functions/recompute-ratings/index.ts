// Supabase Edge Function — admin-only. Rebuilds EVERY player's rating
// from the complete confirmed match history, replayed from scratch in
// chronological order. See replay.ts for the full explanation (including
// how it respects each player's reset-history point, and how the final
// write is applied atomically).
//
// Two ways this gets triggered:
// 1. Directly, from a "Recompute history" button on Admin management —
//    a general-purpose "make sure everything's consistent" tool.
// 2. Automatically from delete-match, whenever a CONFIRMED match gets
//    deleted — since only a full replay can correctly remove that game's
//    effect on everything computed after it.
//
// Call with no body.

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
    const { data: callerData } = await callerClient.auth.getUser();
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

    const result = await recomputeAllRatings(supabase);
    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
