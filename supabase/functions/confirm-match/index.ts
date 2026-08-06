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

Deno.serve(async (req) => {
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
      return new Response(JSON.stringify({ error: "not signed in" }), { status: 401 });
    }
    const { data: callerPlayer } = await supabase
      .from("players")
      .select("is_admin")
      .eq("id", callerId)
      .single();
    if (!callerPlayer?.is_admin) {
      return new Response(JSON.stringify({ error: "admins only" }), { status: 403 });
    }

    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), {
        status: 400,
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
      });
    }
    if (match.status !== "pending") {
      return new Response(
        JSON.stringify({ error: `match is already ${match.status}` }),
        { status: 409 }
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
        { status: 500 }
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

    const newTeamA = updateRating(teamA, teamB, actualA);
    const newTeamB = updateRating(teamB, teamA, actualB);

    // Apply the whole team-level delta identically to both teammates —
    // confirmed to match the old system's behavior (see comment above).
    const deltaA = newTeamA.rating - teamA.rating;
    const deltaB = newTeamB.rating - teamB.rating;

    const updatedPlayers = [
      { ...rA1, rating: rA1.rating + deltaA, rd: newTeamA.rd, volatility: newTeamA.volatility },
      { ...rA2, rating: rA2.rating + deltaA, rd: newTeamA.rd, volatility: newTeamA.volatility },
      { ...rB1, rating: rB1.rating + deltaB, rd: newTeamB.rd, volatility: newTeamB.volatility },
      { ...rB2, rating: rB2.rating + deltaB, rd: newTeamB.rd, volatility: newTeamB.volatility },
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
        { match_id, player_id: rA1.player_id, team: "a", pre_rating: rA1.rating, pre_rd: rA1.rd, post_rating: rA1.rating + deltaA, post_rd: newTeamA.rd },
        { match_id, player_id: rA2.player_id, team: "a", pre_rating: rA2.rating, pre_rd: rA2.rd, post_rating: rA2.rating + deltaA, post_rd: newTeamA.rd },
        { match_id, player_id: rB1.player_id, team: "b", pre_rating: rB1.rating, pre_rd: rB1.rd, post_rating: rB1.rating + deltaB, post_rd: newTeamB.rd },
        { match_id, player_id: rB2.player_id, team: "b", pre_rating: rB2.rating, pre_rd: rB2.rd, post_rating: rB2.rating + deltaB, post_rd: newTeamB.rd },
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

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
