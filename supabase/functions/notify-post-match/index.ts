// Supabase Edge Function — fired fire-and-forget from MatchEntry.tsx right
// after a match is successfully confirmed (see submitOneMatch() there,
// 2026-08-28). Checks the 4 players involved for two kinds of push
// notification, both gated on the player's own granular preference
// (players.notify_badge_earned / notify_rank_change) via send-push's
// Branch B, which re-checks the preference itself as a safety net — this
// function doesn't need to.
//
// ── Scope note (deliberate, not an oversight) ───────────────────────────
// Only a SIMPLE subset of the full badge set (src/lib/badges.ts) is
// checked here: games-played milestones, games-won milestones, win-streak
// milestones, and four single-game "first time" badges (first win,
// standout win, twenty pointer, first time pickled). Badges like
// Rollercoaster, Steady Eddie, Bracket Buster, Comeback, Heartbreak, Point
// Hoarder, and every season/competition/monthly-finish badge are NOT
// checked here — they'd require re-implementing much more of
// badges.ts's logic server-side (rating-swing windows, rolling-window
// losses, full-history replay) for badges that are much rarer to begin
// with. Those still appear correctly on the Dashboard next time the player
// opens the app; they just won't trigger an instant push. If this gap
// matters in practice, the fix is to port more of computeBadges() here —
// deliberately deferred rather than guessed at.
//
// Rank-change detection covers entering/exiting the Top 10 only (not
// every rank move), using players.last_known_rank as a bookmark so a push
// only fires on the game that actually crosses the boundary.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HistoryRow {
  match_id: string;
  played_at: string;
  own_score: number;
  opponent_score: number;
  won: boolean;
  game_number: number;
}

const GAME_MILESTONES = [10, 25, 50, 100, 200, 250, 500];
const WIN_MILESTONES = [50, 100];
const STREAK_MILESTONES = [3, 6, 10, 15];
const TOP_N = 10;

async function sendBadgePush(playerId: string, title: string, body: string) {
  try {
    await supabase.functions.invoke("send-push", {
      body: { player_id: playerId, title, body, url: "/#dashboard", category: "badge_earned" },
    });
  } catch {
    // Best-effort — a failed push here shouldn't affect anything else,
    // same fire-and-forget spirit as the caller in MatchEntry.tsx.
  }
}

async function sendRankPush(playerId: string, title: string, body: string) {
  try {
    await supabase.functions.invoke("send-push", {
      body: { player_id: playerId, title, body, url: "/#leaderboard", category: "rank_change" },
    });
  } catch {
    // Best-effort, same as above.
  }
}

async function checkBadges(playerId: string, matchId: string) {
  const { data, error } = await supabase
    .from("player_match_history")
    .select("match_id, played_at, own_score, opponent_score, won, game_number")
    .eq("player_id", playerId)
    .order("game_number", { ascending: true });

  if (error || !data || data.length === 0) return;
  const rows = data as HistoryRow[];
  const last = rows[rows.length - 1];
  // Safety check — if this player's most recent confirmed game isn't the
  // match we were called about (e.g. a race with another confirm, or a
  // reset happened in between), skip rather than notify about the wrong
  // game.
  if (last.match_id !== matchId) return;

  const priorRows = rows.slice(0, -1);
  const gamesPlayed = rows.length;
  const gamesWon = rows.filter((r) => r.won).length;

  if (GAME_MILESTONES.includes(gamesPlayed)) {
    await sendBadgePush(
      playerId,
      "New badge earned! 🏆",
      `You've just logged your ${gamesPlayed}th confirmed match.`
    );
  }

  if (last.won && WIN_MILESTONES.includes(gamesWon)) {
    await sendBadgePush(playerId, "New badge earned! 🥇", `You've now won ${gamesWon} confirmed matches.`);
  }

  if (last.won) {
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].won) streak++;
      else break;
    }
    if (STREAK_MILESTONES.includes(streak)) {
      if (streak === 15) {
        await sendBadgePush(playerId, "New badge earned! 🚒", "You've reached a 15-game winning streak — On Fire.");
      } else {
        await sendBadgePush(
          playerId,
          "New badge earned! 🔥",
          `You've reached a ${streak}-game winning streak.`
        );
      }
    }
  }

  if (last.won && !priorRows.some((r) => r.won)) {
    await sendBadgePush(playerId, "New badge earned! 🎉", "You just got your first win!");
  }

  if (last.won && last.own_score - last.opponent_score >= 15) {
    const already = priorRows.some((r) => r.won && r.own_score - r.opponent_score >= 15);
    if (!already) {
      await sendBadgePush(
        playerId,
        "New badge earned! ⚡",
        `Standout win — you beat them ${last.own_score}–${last.opponent_score}, a 15+ point margin.`
      );
    }
  }

  if (last.own_score >= 20) {
    const already = priorRows.some((r) => r.own_score >= 20);
    if (!already) {
      await sendBadgePush(
        playerId,
        "New badge earned! 🎯",
        `Twenty Pointer — you scored ${last.own_score} points in a single game.`
      );
    }
  }

  if (last.own_score === 0) {
    const already = priorRows.some((r) => r.own_score === 0);
    if (!already) {
      await sendBadgePush(playerId, "New badge earned! 🥒", "First time pickled — it happens to everyone eventually.");
    }
  }
}

async function checkRankChange(playerId: string) {
  const { data: playerRow } = await supabase
    .from("player_status")
    .select("last_known_rank, is_active, is_provisional")
    .eq("id", playerId)
    .single();
  if (!playerRow) return;

  const { data: board, error } = await supabase
    .from("leaderboard")
    .select("id, rating")
    .eq("is_active", true)
    .eq("is_provisional", false)
    .order("rating", { ascending: false });
  if (error || !board) return;

  const currentRank = board.findIndex((r) => r.id === playerId) + 1; // 0 if not found (provisional/inactive)
  const newRank = currentRank > 0 ? currentRank : null;
  const oldRank: number | null = playerRow.last_known_rank ?? null;

  if (newRank !== oldRank) {
    if (newRank != null && newRank <= TOP_N && (oldRank == null || oldRank > TOP_N)) {
      await sendRankPush(
        playerId,
        "You're in the Top 10! 📈",
        `You've climbed into rank #${newRank} on the club leaderboard.`
      );
    } else if (oldRank != null && oldRank <= TOP_N && (newRank == null || newRank > TOP_N)) {
      await sendRankPush(
        playerId,
        "Leaderboard update",
        "You've dropped out of the club's Top 10 — time for a comeback."
      );
    }
    await supabase.from("players").update({ last_known_rank: newRank }).eq("id", playerId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), { status: 400, headers: corsHeaders });
    }

    const { data: match } = await supabase
      .from("matches")
      .select("team_a_player_1_id, team_a_player_2_id, team_b_player_1_id, team_b_player_2_id")
      .eq("id", match_id)
      .single();
    if (!match) {
      return new Response(JSON.stringify({ ok: true, skipped: "match not found" }), { status: 200, headers: corsHeaders });
    }

    const playerIds = [
      match.team_a_player_1_id,
      match.team_a_player_2_id,
      match.team_b_player_1_id,
      match.team_b_player_2_id,
    ] as string[];

    for (const playerId of playerIds) {
      await checkBadges(playerId, match_id);
      await checkRankChange(playerId);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
