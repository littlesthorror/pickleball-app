import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../supabaseClient";
import type { MatchStatus } from "../types";

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
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  // Only ever offered for a mis-entered game. The edge function is the
  // real gatekeeper — it refuses (and explains why) if any of the four
  // players have played a match since this one, since rolling their
  // rating back safely is only possible while this is still their most
  // recent confirmed game. See supabase/functions/delete-match.
  async function deleteMatch(m: MatchRow) {
    const teamA = teamLabel(m.team_a_player_1, m.team_a_player_2);
    const teamB = teamLabel(m.team_b_player_1, m.team_b_player_2);
    if (
      !confirm(
        `Delete this game (${teamA} ${m.team_a_score}–${m.team_b_score} ${teamB})? This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingId(m.id);
    const { data, error } = await supabase.functions.invoke("delete-match", {
      body: { match_id: m.id },
    });
    setDeletingId(null);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    if (data?.error) {
      alert(data.error);
      return;
    }
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
        <p>Loading games…</p>
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

              <div style={{ textAlign: "right", marginTop: 8 }}>
                <span
                  className="link-action"
                  role="button"
                  tabIndex={0}
                  style={{ color: "var(--danger)", opacity: deletingId === m.id ? 0.5 : 1, pointerEvents: deletingId ? "none" : "auto" }}
                  onClick={() => deleteMatch(m)}
                >
                  {deletingId === m.id ? "Deleting…" : "Delete — entered in error"}
                </span>
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
