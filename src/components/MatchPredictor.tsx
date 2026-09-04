import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { PlayerSelect } from "../pages/MatchEntry";
import { averageTeam, predictedWinProbability } from "../lib/predict";
import type { PlayerStatus } from "../types";

// Match Predictor (2026-09-04, Ben's idea) — a collapsible "what if" tool at
// the bottom of your own Dashboard: pick any 4 active players (not just
// yourself) and see who Sideline's rating engine currently favours. Reuses
// the exact same win-probability math as Match Entry's "Impact preview"
// (src/lib/predict.ts) — nothing new to compute, just a different UI wrapped
// around it. Collapsed by default, same "Hide ▲ / Show ▼" pattern used for
// Competitions' "New competition" form and Quarterly Cup's fixtures toggle.
export default function MatchPredictor() {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetched lazily, only once the card is actually opened — this renders on
  // every player's Dashboard, so loading the full active roster up front for
  // everyone who never touches it would be a wasted query on every visit.
  useEffect(() => {
    if (!open || players.length > 0) return;
    setLoading(true);
    supabase
      .from("player_status")
      .select("*")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (!error) setPlayers((data ?? []) as PlayerStatus[]);
        setLoading(false);
      });
  }, [open, players.length]);

  const [teamAP1, setTeamAP1] = useState("");
  const [teamAP2, setTeamAP2] = useState("");
  const [teamBP1, setTeamBP1] = useState("");
  const [teamBP2, setTeamBP2] = useState("");

  const selectedIds = [teamAP1, teamAP2, teamBP1, teamBP2].filter(Boolean);
  const allFourPicked = selectedIds.length === 4;
  const noDuplicates = new Set(selectedIds).size === selectedIds.length;
  const byId = (id: string) => players.find((p) => p.id === id);

  const prediction = useMemo(() => {
    if (!allFourPicked || !noDuplicates) return null;
    const a1 = byId(teamAP1);
    const a2 = byId(teamAP2);
    const b1 = byId(teamBP1);
    const b2 = byId(teamBP2);
    if (!a1 || !a2 || !b1 || !b2) return null;
    const teamA = averageTeam(a1, a2);
    const teamB = averageTeam(b1, b2);
    return { teamAProbability: predictedWinProbability(teamA, teamB) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamAP1, teamAP2, teamBP1, teamBP2, players, allFourPicked, noDuplicates]);

  function clearPlayers() {
    setTeamAP1("");
    setTeamAP2("");
    setTeamBP1("");
    setTeamBP2("");
  }

  return (
    <div className="card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }}
      >
        <div>
          <h2 style={{ margin: 0 }}>🔮 Match Predictor</h2>
          <p className="stat-meta" style={{ marginTop: 4, marginBottom: 0 }}>
            Pick any 4 players and see who Sideline currently favours.
          </p>
        </div>
        <span style={{ color: "var(--navy-500)", fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>
          {open ? "Hide ▲" : "Show ▼"}
        </span>
      </div>

      {open &&
        (loading && players.length === 0 ? (
          <p className="stat-meta" style={{ marginTop: 12 }}>
            Loading players…
          </p>
        ) : (
          <>
            {allFourPicked && (
              <div style={{ textAlign: "right", marginTop: 8 }}>
                <span className="link-action" role="button" tabIndex={0} onClick={clearPlayers}>
                  Clear players
                </span>
              </div>
            )}

            <label style={{ marginTop: 16 }}>Team A</label>
            <PlayerSelect
              label="Player 1"
              players={players}
              value={teamAP1}
              onChange={setTeamAP1}
              disabledIds={selectedIds.filter((id) => id !== teamAP1)}
            />
            <PlayerSelect
              label="Player 2"
              players={players}
              value={teamAP2}
              onChange={setTeamAP2}
              disabledIds={selectedIds.filter((id) => id !== teamAP2)}
            />

            <label style={{ marginTop: 16 }}>Team B</label>
            <PlayerSelect
              label="Player 1"
              players={players}
              value={teamBP1}
              onChange={setTeamBP1}
              disabledIds={selectedIds.filter((id) => id !== teamBP1)}
            />
            <PlayerSelect
              label="Player 2"
              players={players}
              value={teamBP2}
              onChange={setTeamBP2}
              disabledIds={selectedIds.filter((id) => id !== teamBP2)}
            />

            {!noDuplicates && allFourPicked && (
              <p className="error">Each player can only be selected once.</p>
            )}

            {prediction && (
              <div className="predicted" style={{ marginTop: 16 }}>
                Predicted: Team A wins ~{Math.round(prediction.teamAProbability * 100)}% of the time
                <br />
                <small>Based on current ratings and rating deviation — same math the engine uses to score real matches. Nothing here is saved.</small>
              </div>
            )}
          </>
        ))}
    </div>
  );
}
