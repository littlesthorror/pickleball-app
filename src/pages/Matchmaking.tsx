import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import { planRounds, ROUND_PRESETS } from "../lib/matchmaking";
import type { RoundPlan } from "../lib/matchmaking";
import type { PlayerStatus } from "../types";
import PageLoading from "../components/PageLoading";

// Smart matchmaking (2026-09-04, Ben's idea) — a separate admin tab right
// after Match Entry: check off who's here tonight, pick roughly how long
// the session will run, and get back a round-by-round plan of balanced 2v2
// courts. All the actual scoring logic lives in src/lib/matchmaking.ts —
// this file is just the picker UI and results display. Purely a planning
// aid; nothing here is written to the database. Admins still enter real
// results through the "Enter match" tab as normal once games are played.
export default function Matchmaking() {
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [numRounds, setNumRounds] = useState<number>(ROUND_PRESETS.sixty);
  const [plan, setPlan] = useState<RoundPlan[] | null>(null);

  useEffect(() => {
    supabase
      .from("player_status")
      .select("*")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setPlayers(((data ?? []) as PlayerStatus[]).sort((a, b) => a.display_name.localeCompare(b.display_name)));
        setLoading(false);
      });
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Any change to who's present invalidates a plan that's already been
    // generated — clearer to hide it than to leave a stale plan on screen
    // that no longer matches the checked-off roster.
    setPlan(null);
  }

  const presentPlayers = players.filter((p) => selected.has(p.id));
  const courtsCount = Math.floor(presentPlayers.length / 4);
  const benchSize = presentPlayers.length - courtsCount * 4;

  if (loading) return <PageLoading label="Loading players…" />;

  return (
    <div>
      <h1>Smart matchmaking</h1>
      <p style={{ color: "#475569" }}>
        Check off who's here tonight and Sideline will suggest balanced courts round by round, based on
        everyone's current rating. It's a planning tool only — nothing here gets saved, so once games are
        played, enter the real results through "Enter match" as normal.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Who's here tonight?</h2>
        <p className="stat-meta" style={{ marginTop: 0 }}>
          {presentPlayers.length} selected
          {courtsCount > 0 ? ` — enough for ${courtsCount} court${courtsCount === 1 ? "" : "s"}` : ""}
          {benchSize > 0 ? `, ${benchSize} sitting out each round` : ""}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
          {players.map((p) => (
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

        <button style={{ marginTop: 16 }} disabled={courtsCount < 1} onClick={() => setPlan(planRounds(presentPlayers, numRounds))}>
          {plan ? "Regenerate" : "Suggest matchups"}
        </button>
        {courtsCount < 1 && presentPlayers.length > 0 && (
          <p className="error">Need at least 4 players selected to make a court.</p>
        )}
      </div>

      {plan && plan.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Suggested rounds</h2>
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
      )}
    </div>
  );
}
