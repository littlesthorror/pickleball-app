// Shared by delete-match, edit-match, and recompute-ratings. Rebuilds
// every player's rating from the complete CONFIRMED match history,
// replayed in chronological order from scratch — as if every game were
// being confirmed fresh, one after another, right now.
//
// Added 2026-08-10 alongside the ability to delete an OLDER game (not
// just each player's most recent one). Deleting an old game breaks the
// normal one-step rollback, because every game after it in the chain was
// computed using ratings that included it — see the conversation this
// was built from. Replaying the whole history sidesteps that: instead of
// trying to undo one game's effect on a rating that's since moved many
// times, every game gets recomputed in order against whatever the
// history says the ratings were at that moment (with the deleted game
// simply absent).
//
// One important wrinkle: reset-player (admin "reset history" per player)
// force-resets a player's LIVE rating back to defaults without touching
// any historical match rows — the old games stay in the log, they just
// stop counting toward that player's own current rating from that point
// on. A naive full replay would ignore that and silently resurrect
// everything the admin reset away. To avoid that, each player's reset_at
// timestamp is treated as its own event in the replay timeline: when the
// replay reaches it, that player's working rating is forced back to
// fresh defaults right then, exactly like reset-player does live — while
// everyone they played before that point keeps the rating changes those
// real historical games actually produced, since that's genuinely what
// happened.
//
// ── 2026-08-10 atomicity pass ────────────────────────────────
// The math and replay logic below stay in TypeScript (already validated
// against live data), but the final write step now goes through a single
// Postgres function — apply_recompute_results — instead of several
// independent client calls. That function's whole body runs as one
// transaction, so a failure partway through can no longer leave
// player_ratings updated while match_participant_ratings is left empty
// (or any other partial mix) — it's all-or-nothing.

import { updateRating, type Glicko2Player } from "./glicko2.ts";

interface WorkingPlayer extends Glicko2Player {
  games_played: number;
}

const DEFAULT_PLAYER: WorkingPlayer = { rating: 1500, rd: 350, volatility: 0.06, games_played: 0 };

type MatchRow = {
  id: string;
  created_at: string;
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  team_a_score: number;
  team_b_score: number;
};

type Event =
  | { type: "reset"; at: string; playerId: string }
  | { type: "match"; at: string; match: MatchRow };

export async function recomputeAllRatings(
  // deno-lint-ignore no-explicit-any
  supabase: any
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [
    { data: players, error: playersError },
    { data: ratingsRows, error: ratingsError },
    { data: matches, error: matchesError },
  ] = await Promise.all([
    supabase.from("players").select("id"),
    supabase.from("player_ratings").select("player_id, reset_at"),
    supabase
      .from("matches")
      .select(
        "id, created_at, team_a_player_1_id, team_a_player_2_id, team_b_player_1_id, team_b_player_2_id, team_a_score, team_b_score"
      )
      .eq("status", "confirmed")
      .order("created_at", { ascending: true }),
  ]);

  if (playersError || !players) return { ok: false, error: playersError?.message ?? "couldn't load players" };
  if (ratingsError || !ratingsRows) return { ok: false, error: ratingsError?.message ?? "couldn't load ratings" };
  if (matchesError || !matches) return { ok: false, error: matchesError?.message ?? "couldn't load match history" };

  const events: Event[] = [
    // deno-lint-ignore no-explicit-any
    ...ratingsRows.filter((r: any) => r.reset_at).map((r: any) => ({ type: "reset" as const, at: r.reset_at, playerId: r.player_id })),
    ...(matches as MatchRow[]).map((m) => ({ type: "match" as const, at: m.created_at, match: m })),
  ];
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const working = new Map<string, WorkingPlayer>(
    // deno-lint-ignore no-explicit-any
    players.map((p: any) => [p.id as string, { ...DEFAULT_PLAYER }])
  );
  const get = (id: string) => working.get(id) ?? { ...DEFAULT_PLAYER };

  // deno-lint-ignore no-explicit-any
  const participantRows: any[] = [];
  const matchUpdates: {
    id: string;
    teamA: Glicko2Player;
    teamB: Glicko2Player;
    newTeamA: Glicko2Player;
    newTeamB: Glicko2Player;
  }[] = [];

  for (const event of events) {
    if (event.type === "reset") {
      working.set(event.playerId, { ...DEFAULT_PLAYER });
      continue;
    }

    const m = event.match;
    const rA1 = get(m.team_a_player_1_id);
    const rA2 = get(m.team_a_player_2_id);
    const rB1 = get(m.team_b_player_1_id);
    const rB2 = get(m.team_b_player_2_id);

    // Team split + margin-of-victory scoring: identical to confirm-match.
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

    const totalScore = m.team_a_score + m.team_b_score;
    const actualA = totalScore > 0 ? m.team_a_score / totalScore : 0.5;
    const actualB = 1 - actualA;

    const newTeamA = updateRating(teamA, teamB, actualA);
    const newTeamB = updateRating(teamB, teamA, actualB);

    const deltaA = newTeamA.rating - teamA.rating;
    const deltaB = newTeamB.rating - teamB.rating;

    working.set(m.team_a_player_1_id, { rating: rA1.rating + deltaA, rd: newTeamA.rd, volatility: newTeamA.volatility, games_played: rA1.games_played + 1 });
    working.set(m.team_a_player_2_id, { rating: rA2.rating + deltaA, rd: newTeamA.rd, volatility: newTeamA.volatility, games_played: rA2.games_played + 1 });
    working.set(m.team_b_player_1_id, { rating: rB1.rating + deltaB, rd: newTeamB.rd, volatility: newTeamB.volatility, games_played: rB1.games_played + 1 });
    working.set(m.team_b_player_2_id, { rating: rB2.rating + deltaB, rd: newTeamB.rd, volatility: newTeamB.volatility, games_played: rB2.games_played + 1 });

    participantRows.push(
      { match_id: m.id, player_id: m.team_a_player_1_id, team: "a", pre_rating: rA1.rating, pre_rd: rA1.rd, post_rating: rA1.rating + deltaA, post_rd: newTeamA.rd },
      { match_id: m.id, player_id: m.team_a_player_2_id, team: "a", pre_rating: rA2.rating, pre_rd: rA2.rd, post_rating: rA2.rating + deltaA, post_rd: newTeamA.rd },
      { match_id: m.id, player_id: m.team_b_player_1_id, team: "b", pre_rating: rB1.rating, pre_rd: rB1.rd, post_rating: rB1.rating + deltaB, post_rd: newTeamB.rd },
      { match_id: m.id, player_id: m.team_b_player_2_id, team: "b", pre_rating: rB2.rating, pre_rd: rB2.rd, post_rating: rB2.rating + deltaB, post_rd: newTeamB.rd }
    );

    matchUpdates.push({ id: m.id, teamA, teamB, newTeamA, newTeamB });
  }

  const finalRatingRows = Array.from(working.entries()).map(([player_id, p]) => ({
    player_id,
    rating: p.rating,
    rd: p.rd,
    volatility: p.volatility,
    games_played: p.games_played,
  }));

  const matchUpdateRows = matchUpdates.map((u) => ({
    id: u.id,
    team_a_pre_rating: u.teamA.rating,
    team_a_pre_rd: u.teamA.rd,
    team_b_pre_rating: u.teamB.rating,
    team_b_pre_rd: u.teamB.rd,
    team_a_post_rating: u.newTeamA.rating,
    team_a_post_rd: u.newTeamA.rd,
    team_b_post_rating: u.newTeamB.rating,
    team_b_post_rd: u.newTeamB.rd,
  }));

  // Everything below happens inside ONE Postgres function call — see the
  // apply_recompute_results migration. Either the whole thing lands, or
  // none of it does; there's no partial-write state to worry about.
  const { error: rpcError } = await supabase.rpc("apply_recompute_results", {
    rating_rows: finalRatingRows,
    participant_rows: participantRows,
    match_update_rows: matchUpdateRows,
  });

  if (rpcError) return { ok: false, error: rpcError.message };

  return { ok: true };
}
