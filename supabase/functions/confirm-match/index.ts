// Supabase Edge Function — runs server-side when a match gets confirmed.
// Deploy with: supabase functions deploy confirm-match
// Call it with { "match_id": "..." } once the opposing-team player has
// confirmed a pending match.
//
// ── 2v2 team-split method — RESOLVED 2026-08-04 ─────────────────────────
// Read directly from the club's existing Google Apps Script source. The old
// system (plain Elo, no RD) does exactly what this file implements:
//   - Team rating = simple average of the two teammates' current ratings.
//   - Margin of victory: each team's "actual score" fed into the rating
//     formula is its raw score as a fraction of the game's total points
//     (e.g. an 11-5 win = 11/16 = 0.6875), NOT a flat win=1/loss=0 and NOT
//     the point-bucket table (that table only feeds a separate, unrelated
//     "Leaderboard" tab).
//   - The same rating delta is applied to both teammates.
//   - Old system used a fixed K-factor of 32; this file uses Glicko-2
//     instead (K-factor's role is played by RD + volatility, which is the
//     whole point of upgrading — new/uncertain players move faster
//     automatically instead of everyone moving at the same fixed rate).
// This is no longer a placeholder guess — see PROJECT_BRIEF.md "Open
// questions" for the full writeup and the exact source lines confirmed.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { updateRating, type Glicko2Player } from "./glicko2.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  // Service role key bypasses RLS — this function is the only place
  // allowed to write ratings, which is the whole point per the brief
  // ("centralized, can't be tampered with from the browser").
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Added 2026-08-27 — this function was missing CORS/preflight handling
// entirely (no OPTIONS branch, no Access-Control-* headers on any
// response). Supabase support flagged this as the likely cause of an
// admin's "Failed to send a request to the Edge Function" errors on
// Android Chrome. Worth noting it doesn't fully explain why it only broke
// for them and not other browsers/devices calling the same function — a
// genuinely missing preflight response should fail identically for any
// spec-compliant browser — but it's a real gap regardless (every response
// below was missing CORS headers) and Supabase's own docs recommend
// exactly this, so fixing it here removes the variable either way.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // verify_jwt (set at deploy time) already guarantees the caller is
    // signed in — but any signed-in player could otherwise call this
    // directly and force-confirm a match. Only admins are allowed to.
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

    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("*")
      .eq("id", match_id)
      .single();

    if (matchError || !match) {
      return new Response(JSON.stringify({ error: "match not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }
    if (match.status !== "pending") {
      return new Response(
        JSON.stringify({ error: `match is already ${match.status}` }),
        { status: 409, headers: corsHeaders }
      );
    }

    const playerIds = [
      match.team_a_player_1_id,
      match.team_a_player_2_id,
      match.team_b_player_1_id,
      match.team_b_player_2_id,
    ];

    const { data: ratings, error: ratingsError } = await supabase
      .from("player_ratings")
      .select("*")
      .in("player_id", playerIds);

    if (ratingsError || !ratings || ratings.length !== 4) {
      return new Response(
        JSON.stringify({ error: "couldn't load all four players' ratings" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const ratingByPlayer = new Map(ratings.map((r) => [r.player_id, r]));
    const rA1 = ratingByPlayer.get(match.team_a_player_1_id)!;
    const rA2 = ratingByPlayer.get(match.team_a_player_2_id)!;
    const rB1 = ratingByPlayer.get(match.team_b_player_1_id)!;
    const rB2 = ratingByPlayer.get(match.team_b_player_2_id)!;

    // Team split: simple average of rating/RD/volatility — confirmed to match
    // the old spreadsheet's approach (see comment above).
    const teamA: Glicko2Player = {
      rating: (rA1.rating + rA2.rating) / 2,
      rd: (rA1.rd + rA2.rd) / 2,
      volatility: (rA1.volatility + rA2.volatility) / 2,
    };
    const teamB: Glicko2Player = {
      rating: (rB1.rating + rB2.rating) / 2,
      rd: (rB1.rd + rB2.rd) / 2,
      volatility: (rB1.volatility + rB2.volatility) / 2,
    };

    // Margin-of-victory "actual score", matching the old spreadsheet exactly:
    // each team's raw score as a fraction of total points scored.
    const totalScore = match.team_a_score + match.team_b_score;
    const actualA = totalScore > 0 ? match.team_a_score / totalScore : 0.5;
    const actualB = 1 - actualA;

    // Confidence-damping fix (2026-09-10, Ben's request): a team's own
    // rating swing is damped when the OPPOSING team contains a still-
    // provisional player, using the weaker (fewer games played) of the two
    // opponents — same "weakest link" convention as the Bracket Buster
    // badge's opponent_min_game_number. 12 games = full confidence, matching
    // MENTOR_PROVISIONAL_GAMES elsewhere in the codebase. This only damps
    // each team's OWN delta — the opposing (provisional) team's own
    // updateRating() call always uses confidence 1, so new players still
    // converge to their true rating at normal speed.
    const confidenceForTeamA = Math.min(1, Math.max(0, Math.min(rB1.games_played, rB2.games_played)) / 12);
    const confidenceForTeamB = Math.min(1, Math.max(0, Math.min(rA1.games_played, rA2.games_played)) / 12);

    const newTeamA = updateRating(teamA, teamB, actualA, confidenceForTeamA);
    const newTeamB = updateRating(teamB, teamA, actualB, confidenceForTeamB);

    // Per-player update (2026-10-13, Ben's request, applies to matches from
    // that date onward — see PER_PLAYER_UPDATE_FROM in replay.ts). Before,
    // the team's averaged RD drove one swing applied identically to both
    // partners, so a brand-new player (RD 350) made their settled partner
    // lose/gain far too much (e.g. -75 in a 2-15 loss) and inflated that
    // partner's RD too. Now each player is updated using THEIR OWN RD and
    // volatility against the opposing team, so a settled player's swing
    // stays small whoever they partner, while the new player still
    // converges quickly. Opponent-confidence damping is unchanged.
    // A player's swing is also capped at the old team-averaged swing, so a
    // newcomer (whose own RD is huge) can never move MORE than they did
    // before this change — the fix only ever protects settled partners.
    const teamDeltaA = newTeamA.rating - teamA.rating;
    const teamDeltaB = newTeamB.rating - teamB.rating;
    // 2026-10-19 (Ben's request): a player with fewer than 12 games can't
    // GAIN more than 25 points from a single game (e.g. a brand-new player
    // went +39 in their 3rd game on a 12-1 win). Losses are unaffected. Must
    // stay identical to replay.ts.
    const PROVISIONAL_GAMES = 12;
    const PROVISIONAL_MAX_GAIN = 25;
    const individual = (
      p: { rd: number; volatility: number; games_played: number },
      team: Glicko2Player,
      opp: Glicko2Player,
      actual: number,
      confidence: number,
      teamDelta: number
    ) => {
      const res = updateRating({ rating: team.rating, rd: p.rd, volatility: p.volatility }, opp, actual, confidence);
      const raw = res.rating - team.rating;
      let capped = Math.sign(raw) === Math.sign(teamDelta) ? Math.sign(raw) * Math.min(Math.abs(raw), Math.abs(teamDelta)) : raw;
      if (p.games_played < PROVISIONAL_GAMES && capped > PROVISIONAL_MAX_GAIN) capped = PROVISIONAL_MAX_GAIN;
      return { delta: capped, rd: res.rd, volatility: res.volatility };
    };
    const uA1 = individual(rA1, teamA, teamB, actualA, confidenceForTeamA, teamDeltaA);
    const uA2 = individual(rA2, teamA, teamB, actualA, confidenceForTeamA, teamDeltaA);
    const uB1 = individual(rB1, teamB, teamA, actualB, confidenceForTeamB, teamDeltaB);
    const uB2 = individual(rB2, teamB, teamA, actualB, confidenceForTeamB, teamDeltaB);

    const updatedPlayers = [
      { ...rA1, rating: rA1.rating + uA1.delta, rd: uA1.rd, volatility: uA1.volatility },
      { ...rA2, rating: rA2.rating + uA2.delta, rd: uA2.rd, volatility: uA2.volatility },
      { ...rB1, rating: rB1.rating + uB1.delta, rd: uB1.rd, volatility: uB1.volatility },
      { ...rB2, rating: rB2.rating + uB2.delta, rd: uB2.rd, volatility: uB2.volatility },
    ];

    for (const p of updatedPlayers) {
      await supabase
        .from("player_ratings")
        .update({
          rating: p.rating,
          rd: p.rd,
          volatility: p.volatility,
          games_played: p.games_played + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("player_id", p.player_id);
    }

    await supabase
      .from("match_participant_ratings")
      .insert([
        { match_id, player_id: rA1.player_id, team: "a", pre_rating: rA1.rating, pre_rd: rA1.rd, post_rating: rA1.rating + uA1.delta, post_rd: uA1.rd },
        { match_id, player_id: rA2.player_id, team: "a", pre_rating: rA2.rating, pre_rd: rA2.rd, post_rating: rA2.rating + uA2.delta, post_rd: uA2.rd },
        { match_id, player_id: rB1.player_id, team: "b", pre_rating: rB1.rating, pre_rd: rB1.rd, post_rating: rB1.rating + uB1.delta, post_rd: uB1.rd },
        { match_id, player_id: rB2.player_id, team: "b", pre_rating: rB2.rating, pre_rd: rB2.rd, post_rating: rB2.rating + uB2.delta, post_rd: uB2.rd },
      ]);

    await supabase
      .from("matches")
      .update({
        status: "confirmed",
        confirmed_by: callerId,
        team_a_pre_rating: teamA.rating,
        team_a_pre_rd: teamA.rd,
        team_b_pre_rating: teamB.rating,
        team_b_pre_rd: teamB.rd,
        team_a_post_rating: newTeamA.rating,
        team_a_post_rd: newTeamA.rd,
        team_b_post_rating: newTeamB.rating,
        team_b_post_rd: newTeamB.rd,
      })
      .eq("id", match_id);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
