import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import type { MatchStatus } from "../types";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import PageLoading from "../components/PageLoading";
import { fetchAllRows } from "../lib/fetchAllRows";

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
  // Search (2026-09-24, Ben's request) — matches by player name (any of
  // the 4 slots) or by score. The normal view below stays efficiently
  // server-paginated (only ever fetches 20 rows at a time), but searching
  // "any game with this player in it" isn't something a single page can
  // answer, so a search fetches the WHOLE match history once (via
  // fetchAllRows, same fix as ClubStats' PostgREST 1000-row cap issue)
  // and filters/paginates that client-side instead. Only fetched lazily,
  // the first time someone actually types something.
  const [search, setSearch] = useState("");
  const [allMatches, setAllMatches] = useState<MatchRow[] | null>(null);
  const [allMatchesLoading, setAllMatchesLoading] = useState(false);
  const [allMatchesError, setAllMatchesError] = useState<string | null>(null);
  const searchActive = search.trim().length > 0;

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

  // Refreshes the normal paginated view AND drops the cached full-history
  // search results (if any), so an edit/delete made while searching
  // doesn't leave stale rows/scores behind in that cached copy — the
  // search effect above re-fetches automatically once allMatches is null
  // again, same as its very first load.
  function reload() {
    load();
    setAllMatches(null);
  }

  useEffect(() => {
    if (!searchActive || allMatches !== null || allMatchesLoading) return;
    setAllMatchesLoading(true);
    setAllMatchesError(null);
    // Typed <any> here rather than <MatchRow> — Supabase's query builder
    // infers an embedded to-one relation (via the named FK hint) as an
    // array shape without generated DB types telling it otherwise, same
    // reason load()'s own query above casts its result afterward instead
    // of typing the select() call directly.
    fetchAllRows<any>((from, to) =>
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
        `
        )
        .order("played_at", { ascending: false })
        .range(from, to)
    ).then(({ data, error }) => {
      setAllMatchesLoading(false);
      if (error) setAllMatchesError(error);
      else setAllMatches(data as unknown as MatchRow[]);
    });
  }, [searchActive, allMatches, allMatchesLoading]);

  // Reset to page 1 whenever the search text changes (including clearing
  // it) — a page number left over from a longer filtered/unfiltered list
  // could otherwise point past the end of a shorter one.
  useEffect(() => {
    setPage(0);
  }, [search]);

  const searchResults = useMemo(() => {
    if (!searchActive || !allMatches) return [];
    const q = search.trim().toLowerCase();
    return allMatches.filter((m) => {
      const names = [m.team_a_player_1, m.team_a_player_2, m.team_b_player_1, m.team_b_player_2].map(
        (p) => p?.display_name.toLowerCase() ?? ""
      );
      const scoreText = `${m.team_a_score}-${m.team_b_score}`;
      const reverseScoreText = `${m.team_b_score}-${m.team_a_score}`;
      return names.some((n) => n.includes(q)) || scoreText.includes(q) || reverseScoreText.includes(q);
    });
  }, [search, allMatches, searchActive]);

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
        `Delete this game (${teamA} ${m.team_a_score}–${m.team_b_score} ${teamB})? The match record itself is gone permanently — this can't be undone. If it's confirmed, EVERY player in the club gets their rating recalculated from scratch from the remaining match history afterward — not just these four — which can also change career highs and games-played counts club-wide, live, right away. Only delete a confirmed game if you're sure it shouldn't count.`,
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
        reload();
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
    reload();
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
    // Ties allowed (2026-09-09) — the club plays fixed 9-minute games, so a
    // genuine equal-score draw is legitimate here too. (A "scores can't be
    // equal" block briefly lived here based on a wrong assumption about
    // the club's format — reverted the same day per Ben.)

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
        reload();
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
    reload();
  }

  // While searching, everything below reads from the client-filtered/
  // paginated searchResults instead of the normal server-paginated
  // matches/totalCount — same PAGE_SIZE, same page state, just a
  // different source list.
  const displayedMatches = searchActive ? searchResults.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : matches;
  const displayedTotalCount = searchActive ? searchResults.length : totalCount;
  const displayedLoading = searchActive ? allMatchesLoading : loading;
  const displayedError = searchActive ? allMatchesError : error;

  const totalPages = Math.max(1, Math.ceil(displayedTotalCount / PAGE_SIZE));
  const from = displayedTotalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(displayedTotalCount, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <h1>Game history</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Every game entered into the system, newest first.
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by player name or score…"
        style={{ marginBottom: 16 }}
      />

      {displayedLoading ? (
        <PageLoading label="Loading games…" />
      ) : displayedError ? (
        <p className="error">{displayedError}</p>
      ) : displayedMatches.length === 0 ? (
        <p className="stat-meta">{searchActive ? "No games match your search." : "No games have been entered yet."}</p>
      ) : (
        <>
          <p className="stat-meta">
            Showing {from}–{to} of {displayedTotalCount} game{displayedTotalCount === 1 ? "" : "s"}
          </p>

          {displayedMatches.map((m) => (
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
                  {/* Time added 2026-09-15 — with no time shown, several
                      games from the same session (same date) were
                      impossible to tell apart when trying to find a
                      specific one to delete (came up for real, tracking
                      down duplicate Cup matches). */}
                  {" · "}
                  {new Date(m.played_at).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
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
