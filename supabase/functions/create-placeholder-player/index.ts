// Supabase Edge Function — admin-only. Creates a "placeholder"/dummy player
// for a club member who's reluctant to sign up themselves, so an admin can
// still register them in matches and competitions run through the app
// (2026-09-01, Ben's request).
//
// players.id is a foreign key into auth.users (players_id_fkey), so a
// placeholder still needs a real row there — there's no way around that
// constraint without weakening it for every real account too. Instead this
// creates a genuine auth user with a random, never-shared email/password
// and immediately bans it for ~100 years (same ban_duration pattern as
// delete-account/index.ts) so it can never actually be signed into. From
// there it's a completely normal players + player_ratings row (mirroring
// what redeem_invite_code does for a real signup), just flagged
// is_placeholder = true so the UI can show a small "Guest" tag.
//
// Call with { "display_name": "..." }.

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
    const { data: callerPlayer } = await supabase
      .from("players")
      .select("is_admin")
      .eq("id", callerId)
      .single();
    if (!callerPlayer?.is_admin) {
      return new Response(JSON.stringify({ error: "admins only" }), { status: 403, headers: corsHeaders });
    }

    const { display_name } = await req.json();
    const name = typeof display_name === "string" ? display_name.trim() : "";
    if (!name) {
      return new Response(JSON.stringify({ error: "display_name is required" }), { status: 400, headers: corsHeaders });
    }

    // A random, never-communicated email/password — nobody is ever meant
    // to use these to sign in. The ban below is the real backstop.
    const randomSuffix = crypto.randomUUID();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: `placeholder-${randomSuffix}@sideline.invalid`,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return new Response(
        JSON.stringify({ error: createError?.message ?? "Couldn't create the underlying account." }),
        { status: 500, headers: corsHeaders }
      );
    }
    const newId = created.user.id;

    const { error: banError } = await supabase.auth.admin.updateUserById(newId, {
      ban_duration: "876000h", // ~100 years — see delete-account/index.ts for the same pattern.
    });
    if (banError) {
      // Don't leave a not-banned, not-yet-a-player auth user behind.
      await supabase.auth.admin.deleteUser(newId).catch(() => {});
      return new Response(JSON.stringify({ error: `Couldn't lock the account down: ${banError.message}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const { error: playerError } = await supabase.from("players").insert({
      id: newId,
      display_name: name,
      is_placeholder: true,
      // Skip the first-time profile setup flow entirely — this player will
      // never sign in to see it.
      profile_completed: true,
    });
    if (playerError) {
      await supabase.auth.admin.deleteUser(newId).catch(() => {});
      return new Response(JSON.stringify({ error: playerError.message }), { status: 500, headers: corsHeaders });
    }

    const { error: ratingError } = await supabase.from("player_ratings").insert({ player_id: newId });
    if (ratingError) {
      return new Response(
        JSON.stringify({ error: `Player created, but rating setup failed: ${ratingError.message}` }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true, id: newId }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
