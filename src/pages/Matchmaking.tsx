import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import { useDraft } from "../lib/useDraft";
import { planRounds, serializeRounds, hydrateRounds, ROUND_PRESETS } from "../lib/matchmaking";
import type { PlayerStatus } from "../types";
import PageLoading from "../components/PageLoading";

const MATCHMAKING_DRAFT_KEY = "sideline-matchmaking-draft";

type SortMode = "az" | "active" | "rating" | "leaderboard";

// Smart matchmaking (2026-09-04, Ben's idea) — a separate admin tab right
// after Match Entry: check off who's here tonight, pick roughly how long
// the session will run, and get back a round-by-round plan of balanced 2v2
// courts. All the actual scoring logic lives in src/lib/matchmaking.ts —
// this file is just the picker UI and results display. Purely a planning
// aid; nothing here is written to the database. Admins still enter real
// results through the "Enter match" tab as normal once games are played.
//
// State (who's checked off, session length, the generated plan) is kept in
// sessionStorage via useDraft rather than plain useState (2026-09-05, fixing
// Ben's report) — this tab unmounts every time you switch to another tab in
// App.tsx, and plain React state would be wiped the moment you flicked over
// to "Enter match" mid-session to log a score.
export default function Matchmaking() {
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("active");

  const [draft, setDraft] = useDraft(MATCHMAKING_DRAFT_KEY, {
    selectedIdsJson: "",
    numRounds: String(ROUND_PRESETS.sixty),
    planJson: "",
  });

  useEffect(() => {
    supabase
      .from("player_status")
      .select("*")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setPlayers((data ?? []) as PlayerStatus[]);
        setLoading(false);
      });
  }, []);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const selected = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(draft.selectedIdsJson || "[]"));
    } catch {
      return new Set<string>();
    }
  }, [draft.selectedIdsJson]);

  const numRounds = Number(draft.numRounds) || ROUND_PRESETS.sixty;

  // Rehydrated from player IDs against whichever players are currently
  // loaded — see hydrateRounds' own comment on why this can come back null.
  const plan = useMemo(() => {
    if (!draft.planJson || players.length === 0) return null;
    try {
      return hydrateRounds(JSON.parse(draft.planJson), byId);
    } catch {
      return null;
    }
  }, [draft.planJson, byId, players.length]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Any change to who's present invalidates a plan that's already been
    // generated — clearer to hide it than to leave a stale plan on screen
    // that no longer matches the checked-off roster.
    setDraft((d) => ({ ...d, selectedIdsJson: JSON.stringify([...next]), planJson: "" }));
  }

  function clearSelection() {
    setDraft((d) => ({ ...d, selectedIdsJson: "", planJson: "" }));
  }

  function setNumRounds(n: number) {
    setDraft((d) => ({ ...d, numRounds: String(n) }));
  }

  const presentPlayers = players.filter((p) => selected.has(p.id));
  const courtsCount = Math.floor(presentPlayers.length / 4);
  const benchSize = presentPlayers.length - courtsCount * 4;

  function generate() {
    const newPlan = planRounds(presentPlayers, numRounds);
    setDraft((d) => ({ ...d, planJson: JSON.stringify(serializeRounds(newPlan)) }));
  }

  // Sort first (so "most regular"/"highest rated"/"leaderboard order" put
  // the likely regulars up top out of ~100 members), then filter by the
  // search box on top of that — makes finding tonight's group fast without
  // needing to know exactly how a name is spelled.
  const sortedPlayers = useMemo(() => {
    const list = [...players];
    switch (sortMode) {
      case "active":
        return list.sort((a, b) => b.games_played - a.games_played || a.display_name.localeCompare(b.display_name));
      case "rating":
        return list.sort((a, b) => b.rating - a.rating);
      case "leaderboard": {
        // Mirrors how the Leaderboard page itself is grouped — ranked
        // (established) players by rating first, then everyone still
        // establishing — rather than one flat rating sort, which would mix
        // brand-new players in among settled ones.
        const established = list.filter((p) => !p.is_provisional).sort((a, b) => b.rating - a.rating);
        const provisional = list.filter((p) => p.is_provisional).sort((a, b) => b.rating - a.rating);
        return [...established, ...provisional];
      }
      case "az":
      default:
        return list.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }
  }, [players, sortMode]);

  const visiblePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedPlayers;
    return sortedPlayers.filter((p) => p.display_name.toLowerCase().includes(q));
  }, [sortedPlayers, search]);

  if (loading) return <PageLoading label="Loading players…" />;

  return (
    <div>
      <h1>Smart matchmaking</h1>
      <p style={{ color: "#475569" }}>
        Check off who's here tonight and Sideline will suggest balanced courts round by round, based on
        everyone's current rating. It's a planning tool only — nothing here gets saved to anyone's record, so
        once games are played, enter the real results through "Enter match" as normal.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h2 style={{ marginTop: 0 }}>Who's here tonight?</h2>
          {selected.size > 0 && (
            <span className="link-action" role="button" tabIndex={0} onClick={clearSelection}>
              Clear selection
            </span>
          )}
        </div>
        <p className="stat-meta" style={{ marginTop: 0 }}>
          {presentPlayers.length} selected
          {courtsCount > 0 ? ` — enough for ${courtsCount} court${courtsCount === 1 ? "" : "s"}` : ""}
          {benchSize > 0 ? `, ${benchSize} sitting out each round` : ""}
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 200px" }}
          />
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={{ flex: "0 0 auto" }}>
            <option value="active">Sort: Most regular players</option>
            <option value="rating">Sort: Highest rated players</option>
            <option value="leaderboard">Sort: Current leaderboard order</option>
            <option value="az">Sort: A–Z</option>
          </select>
        </div>

        {visiblePlayers.length === 0 ? (
          <p className="stat-meta">No players match "{search}".</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
            {visiblePlayers.map((p) => (
              <label
                key={p.id}
                style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}
              >
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <Avatar name={p.display_name} url={p.avatar_url} size={22} />
                {p.display_name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Session length</h2>
        <div className="toggle-group">
          <button disabled={numRounds === ROUND_PRESETS.sixty} onClick={() => setNumRounds(ROUND_PRESETS.sixty)}>
            60 min (~{ROUND_PRESETS.sixty} rounds)
          </button>
          <button disabled={numRounds === ROUND_PRESETS.ninety} onClick={() => setNumRounds(ROUND_PRESETS.ninety)}>
            90 min (~{ROUND_PRESETS.ninety} rounds)
          </button>
        </div>
        <label style={{ marginTop: 14 }}>Or set the number of rounds manually</label>
        <input
          type="number"
          min={1}
          max={15}
          value={numRounds}
          onChange={(e) => setNumRounds(Math.min(15, Math.max(1, Number(e.target.value) || 1)))}
          style={{ width: 100 }}
        />

        <button style={{ marginTop: 16 }} disabled={courtsCount < 1} onClick={generate}>
          {plan ? "Regenerate" : "Suggest matchups"}
        </button>
        {courtsCount < 1 && presentPlayers.length > 0 && (
          <p className="error">Need at least 4 players selected to make a court.</p>
        )}
      </div>

      {plan && plan.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>Suggested rounds</h2>
            <div style={{ display: "flex", gap: 14 }}>
              <span className="link-action" role="button" tabIndex={0} onClick={() => window.print()}>
                Print
              </span>
            </div>
          </div>

          <div className="print-area" style={{ marginTop: 12 }}>
            <p className="print-only" style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 16 }}>
              Sideline — suggested matchups —{" "}
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            {plan.map((round, i) => (
              <div
                key={i}
                style={{
                  marginTop: i === 0 ? 0 : 20,
                  paddingTop: i === 0 ? 0 : 16,
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <h3 style={{ margin: "0 0 8px" }}>Round {i + 1}</h3>
                {round.courts.map((c, ci) => (
                  <div className="match-row" key={ci}>
                    <div className="opponent">
                      Court {ci + 1}: {c.teamA[0].display_name} & {c.teamA[1].display_name} vs{" "}
                      {c.teamB[0].display_name} & {c.teamB[1].display_name}
                    </div>
                    <div className="score">
                      {Math.round(c.teamAProbability * 100)}–{Math.round((1 - c.teamAProbability) * 100)}
                    </div>
                  </div>
                ))}
                {round.sittingOut.length > 0 && (
                  <p className="stat-meta" style={{ marginTop: 8, marginBottom: 0 }}>
                    Sitting out: {round.sittingOut.map((p) => p.display_name).join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
