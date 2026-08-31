import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import type { MatchStatus } from "../types";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import PageLoading from "../components/PageLoading";

const PAGE_SIZE = 20;

// A player name as embedded via a matches -> players foreign key. Each of
// the four player slots on a match points at players.id through its own
// named FK constraint (matches_team_a_player_1_id_fkey etc.), so Supabase
// can embed the display name directly in one query rather than needing a
// separate id -> name lookup pass.
interface EmbeddedPlayer {
  display_name: string;
}

interface MatchRow {
  id: string;
  played_at: string;
  team_a_score: number;
  team_b_score: number;
  status: MatchStatus;
  team_a_player_1: EmbeddedPlayer | null;
  team_a_player_2: EmbeddedPlayer | null;
  team_b_player_1: EmbeddedPlayer | null;
  team_b_player_2: EmbeddedPlayer | null;
}

function statusStyle(status: MatchStatus): CSSProperties {
  if (status === "confirmed") {
    return { background: "#eaf6ef", color: "var(--success)" };
  }
  if (status === "disputed") {
    return { background: "#fdeceb", color: "var(--danger)" };
  }
  return { background: "#eef1f6", color: "var(--text-muted)" };
}

function teamLabel(p1: EmbeddedPlayer | null, p2: EmbeddedPlayer | null) {
  return `${p1?.display_name ?? "?"} & ${p2?.display_name ?? "?"}`;
}

// Admin-only running list of every game entered into the system, newest
// first, with real server-side pagination (not just "load everything and
// slice it client-side") — added 2026-08-10 at Ben's request. Club-sized
// player lists (~200 members) are small enough to fetch in one go, but
// match history only grows over time, so this fetches one page at a time
// straight from the database instead.
export default function GameHistory() {
  const confirm = useConfirm();
  const toast = useToast();
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ teamA: "", teamB: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    supabase
      .from("matches")
      .select(
        `
        id,
        played_at,
        team_a_score,
        team_b_score,
        status,
        team_a_player_1:players!matches_team_a_player_1_id_fkey(display_name),
        team_a_player_2:players!matches_team_a_player_2_id_fkey(display_name),
        team_b_player_1:players!matches_team_b_player_1_id_fkey(display_name),
        team_b_player_2:players!matches_team_b_player_2_id_fkey(display_name)
      `,
        { count: "exact" }
      )
      .order("played_at", { ascending: false })
      .range(from, to)
      .then(({ data, error, count }) => {
        if (error) {
          setError(error.message);
        } else {
          setMatches((data ?? []) as unknown as MatchRow[]);
          setTotalCount(count ?? 0);
        }
        setLoading(false);
      });
  }

  useEffect(load, [page]);

  // Only ever offered for a mis-entered game. Any confirmed game can be
  // deleted, not just the most recent one for its four players — if it's
  // an older game, the edge function automatically recalculates every
  // player's rating from the complete remaining match history afterward,
  // so nothing downstream is left stale. See supabase/functions/delete-match
  // and recompute-ratings/replay.ts. That recompute is the reason an
  // older delete can take noticeably longer than a recent one.
  async function deleteMatch(m: MatchRow) {
    const teamA = teamLabel(m.team_a_player_1, m.team_a_player_2);
    const teamB = teamLabel(m.team_b_player_1, m.team_b_player_2);
    if (
      !(await confirm(
        `Delete this game (${teamA} ${m.team_a_score}–${m.team_b_score} ${teamB})? The match record itself is gone permanently — this can't be undone. If it's confirmed, every player's rating gets recalculated from the remaining match history afterward, which can shift ratings for people who never played in this game, not just these four.`,
        { danger: true }
      ))
    ) {
      return;
    }
    setDeletingId(m.id);
    const { data, error } = await supabase.functions.invoke("delete-match", {
      body: { match_id: m.id },
    });
    setDeletingId(null);

    if (error) {
      // Same reasoning as saveEdit below: a confirmed match's delete
      // involves a full-history recompute, which can take long enough
      // that the client's request times out or drops even though the
      // function itself goes on to finish successfully a moment later.
      // Check whether the match is actually gone before trusting the
      // failed request alone.
      const { data: recheck } = await supabase.from("matches").select("id").eq("id", m.id).maybeSingle();
      if (!recheck) {
        load();
        return;
      }

      // Genuinely still there — supabase-js's default error.message here
      // is a generic wrapper ("Edge Function returned a non-2xx status
      // code" / "Failed to send a request to the Edge Function") — it
      // does NOT include the actual reason the function sent back (e.g.
      // a recompute failure after the game was already deleted). When
      // the function did respond (just with an error status), that real
      // reason is in the response body, reachable via error.context — so
      // unwrap it and show that instead. If the request never got a
      // response at all, there's no body to read and we fall back to a
      // plain, honest message.
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        toast.error(body?.error ?? "Couldn't delete this game.");
      } else {
        toast.error("Couldn't reach the server to delete this game — check your connection and try again.");
      }
      return;
    }
    if (data?.error) {
      toast.error(data.error);
      return;
    }
    load();
  }

  function startEdit(m: MatchRow) {
    setEditingId(m.id);
    setEditDraft({ teamA: String(m.team_a_score), teamB: String(m.team_b_score) });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  // Only the score is editable here (not the players or date) — that's
  // all Ben asked for, and it keeps this simple. A pending/disputed
  // match's new score just gets saved directly, since no rating was ever
  // calculated from the old one. A confirmed match's original score
  // already ran through Glicko-2, with everything played after it
  // computed on top of that result — so like delete-match, this doesn't
  // try to patch just this one game's rating delta. It saves the
  // corrected score and then replays the ENTIRE confirmed match history
  // from scratch (see supabase/functions/edit-match and
  // recompute-ratings/replay.ts), the same machinery already built and
  // validated for deleting an older game.
  async function saveEdit(m: MatchRow) {
    const teamAScore = Number(editDraft.teamA);
    const teamBScore = Number(editDraft.teamB);
    if (
      !Number.isInteger(teamAScore) ||
      !Number.isInteger(teamBScore) ||
      teamAScore < 0 ||
      teamBScore < 0
    ) {
      toast.error("Scores must be whole numbers, zero or higher.");
      return;
    }

    const teamA = teamLabel(m.team_a_player_1, m.team_a_player_2);
    const teamB = teamLabel(m.team_b_player_1, m.team_b_player_2);
    if (
      !(await confirm(
        `Change the score to ${teamA} ${teamAScore}–${teamBScore} ${teamB}? If this game is confirmed, every player's rating gets recalculated from the corrected match history afterward, which can shift ratings for people who never played in this game, not just these four.`
      ))
    ) {
      return;
    }

    setSavingEdit(true);
    const { data, error } = await supabase.functions.invoke("edit-match", {
      body: { match_id: m.id, team_a_score: teamAScore, team_b_score: teamBScore },
    });
    setSavingEdit(false);

    if (error) {
      // A confirmed match's save involves a full-history recompute (see
      // supabase/functions/edit-match), which can take a moment — long
      // enough that the *client's* request can time out or drop even
      // though the function itself goes on to finish successfully a
      // moment later. Rather than trust a failed request alone and show
      // a scary error for something that isn't actually broken, check
      // the match's real saved score before deciding. Mirrors the same
      // fix already in MatchEntry.tsx for confirm-match.
      const { data: recheck } = await supabase
        .from("matches")
        .select("team_a_score, team_b_score")
        .eq("id", m.id)
        .single();

      if (recheck?.team_a_score === teamAScore && recheck?.team_b_score === teamBScore) {
        setEditingId(null);
        load();
        return;
      }

      // Genuinely didn't save — now it's worth unwrapping the real
      // reason from the response body rather than showing supabase-js's
      // generic wrapper message, same as deleteMatch below.
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        toast.error(body?.error ?? "Couldn't save this score.");
      } else {
        toast.error("Couldn't reach the server to save this score — check your connection and try again.");
      }
      return;
    }
    if (data?.error) {
      toast.error(data.error);
      return;
    }
    setEditingId(null);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const from = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(totalCount, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <h1>Game history</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Every game entered into the system, newest first.
      </p>

      {loading ? (
        <PageLoading label="Loading games…" />
      ) : error ? (
        <p className="error">{error}</p>
      ) : matches.length === 0 ? (
        <p className="stat-meta">No games have been entered yet.</p>
      ) : (
        <>
          <p className="stat-meta">
            Showing {from}–{to} of {totalCount} game{totalCount === 1 ? "" : "s"}
          </p>

          {matches.map((m) => (
            <div className="card" key={m.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span className="stat-meta" style={{ marginTop: 0 }}>
                  {new Date(m.played_at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="badge" style={statusStyle(m.status)}>
                  {m.status}
                </span>
              </div>

              {editingId === m.id ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>{teamLabel(m.team_a_player_1, m.team_a_player_2)}</div>
                  <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={editDraft.teamA}
                      onChange={(e) => setEditDraft((d) => ({ ...d, teamA: e.target.value }))}
                      style={{ width: 52, padding: "6px 8px", textAlign: "center", marginTop: 0 }}
                    />
                    <span>–</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={editDraft.teamB}
                      onChange={(e) => setEditDraft((d) => ({ ...d, teamB: e.target.value }))}
                      style={{ width: 52, padding: "6px 8px", textAlign: "center", marginTop: 0 }}
                    />
                  </div>
                  <div style={{ flex: 1, textAlign: "right" }}>{teamLabel(m.team_b_player_1, m.team_b_player_2)}</div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1, fontWeight: m.team_a_score > m.team_b_score ? 700 : 400 }}>
                    {teamLabel(m.team_a_player_1, m.team_a_player_2)}
                  </div>
                  <div style={{ flex: "0 0 auto", fontWeight: 700, fontSize: "1.1rem" }}>
                    {m.team_a_score}–{m.team_b_score}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      textAlign: "right",
                      fontWeight: m.team_b_score > m.team_a_score ? 700 : 400,
                    }}
                  >
                    {teamLabel(m.team_b_player_1, m.team_b_player_2)}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                {editingId === m.id ? (
                  <>
                    <span
                      className="link-action"
                      role="button"
                      tabIndex={0}
                      style={{ color: "var(--text-muted)", opacity: savingEdit ? 0.5 : 1, pointerEvents: savingEdit ? "none" : "auto" }}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </span>
                    <span
                      className="link-action"
                      role="button"
                      tabIndex={0}
                      style={{ color: "var(--orange-600)", opacity: savingEdit ? 0.5 : 1, pointerEvents: savingEdit ? "none" : "auto" }}
                      onClick={() => saveEdit(m)}
                    >
                      {savingEdit ? "Saving…" : "Save"}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="link-action"
                      role="button"
                      tabIndex={0}
                      style={{ opacity: editingId || deletingId ? 0.5 : 1, pointerEvents: editingId || deletingId ? "none" : "auto" }}
                      onClick={() => startEdit(m)}
                    >
                      Edit score
                    </span>
                    <span
                      className="link-action"
                      role="button"
                      tabIndex={0}
                      style={{ color: "var(--danger)", opacity: deletingId === m.id ? 0.5 : editingId || deletingId ? 0.5 : 1, pointerEvents: editingId || deletingId ? "none" : "auto" }}
                      onClick={() => deleteMatch(m)}
                    >
                      {deletingId === m.id ? "Deleting…" : "Delete — entered in error"}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ flex: "0 0 auto", width: "auto", marginTop: 0, background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
            >
              Previous
            </button>
            <span className="stat-meta" style={{ marginTop: 0 }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{ flex: "0 0 auto", width: "auto", marginTop: 0, background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
