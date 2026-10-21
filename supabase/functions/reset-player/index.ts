// Supabase Edge Function — admin-only. Resets one player's rating back to
// a fresh start (1500 / RD 350 / volatility 0.06 / 0 games) WITHOUT
// touching any historical match rows. Old matches stay exactly as they
// were in the database — this only marks a "reset point" on the player's
// own rating record, so their own dashboard/leaderboard entry only counts
// games from here forward. Every other player who's played against them
// keeps their correct, untouched history from those old matches.
//
// Call with { "player_id": "..." }.

import { createClient } from "jsr:@supabase/supabase-js@2";

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

    const { player_id, rating_only } = await req.json();
    if (!player_id) {
      return new Response(JSON.stringify({ error: "player_id is required" }), { status: 400, headers: corsHeaders });
    }

    // rating_only: restart the rating but keep match history, games_played and
    // badges (reset_at stays untouched). See migration 0080.
    if (rating_only) {
      const { data: cur, error: curErr } = await supabase
        .from("player_ratings")
        .select("games_played")
        .eq("player_id", player_id)
        .single();
      if (curErr || !cur) {
        return new Response(JSON.stringify({ error: curErr?.message ?? "player not found" }), { status: 500, headers: corsHeaders });
      }
      const { error: rErr } = await supabase
        .from("player_ratings")
        .update({
          rating: 1500,
          rd: 350,
          volatility: 0.06,
          rating_reset_at: new Date().toISOString(),
          rating_reset_games: cur.games_played,
          updated_at: new Date().toISOString(),
        })
        .eq("player_id", player_id);
      if (rErr) {
        return new Response(JSON.stringify({ error: rErr.message }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
    }

    const { error } = await supabase
      .from("player_ratings")
      .update({
        rating: 1500,
        rd: 350,
        volatility: 0.06,
        games_played: 0,
        rating_reset_at: null,
        rating_reset_games: 0,
        reset_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("player_id", player_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
