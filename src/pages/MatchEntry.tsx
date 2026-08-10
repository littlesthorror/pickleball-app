import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { averageTeam, predictedWinProbability } from "../lib/predict";
import type { PlayerStatus } from "../types";

function PlayerSelect({
  label,
  players,
  value,
  onChange,
  disabledIds,
}: {
  label: string;
  players: PlayerStatus[];
  value: string;
  onChange: (id: string) => void;
  disabledIds: string[];
}) {
  return (
    <div>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select player…</option>
        {players.map((p) => (
          <option key={p.id} value={p.id} disabled={disabledIds.includes(p.id)}>
            {p.display_name}
            {p.is_provisional ? " (provisional)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function MatchEntry() {
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [teamAP1, setTeamAP1] = useState("");
  const [teamAP2, setTeamAP2] = useState("");
  const [teamBP1, setTeamBP1] = useState("");
  const [teamBP2, setTeamBP2] = useState("");
  const [teamAScore, setTeamAScore] = useState("");
  const [teamBScore, setTeamBScore] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Inline confirmation banner instead of a full-screen "Match submitted"
  // takeover — the whole point is to make entering several matches in a
  // row (same 4 players, different scores) fast, so replacing the entire
  // screen after every single game was the opposite of that.
  const [banner, setBanner] = useState<string | null>(null);

  // Jumps focus straight to the Team A score box after a submit, since
  // that's the next thing an admin types when entering another game
  // between the same four players.
  const teamAScoreRef = useRef<HTMLInputElement>(null);

  function loadPlayers() {
    return supabase
      .from("player_status")
      .select("*")
      .eq("is_active", true)
      .order("display_name")
      .then(({ data, error }) => {
        if (error) {
          setLoadError(error.message);
        } else {
          setPlayers((data ?? []) as PlayerStatus[]);
        }
      });
  }

  useEffect(() => {
    let cancelled = false;
    loadPlayers().then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIds = [teamAP1, teamAP2, teamBP1, teamBP2].filter(Boolean);
  const allFourPicked = selectedIds.length === 4;
  const noDuplicates = new Set(selectedIds).size === selectedIds.length;
  const scoresValid =
    teamAScore !== "" &&
    teamBScore !== "" &&
    Number(teamAScore) >= 0 &&
    Number(teamBScore) >= 0;
  const canSubmit = allFourPicked && noDuplicates && scoresValid && !submitting;

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
    return {
      teamAProbability: predictedWinProbability(teamA, teamB),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamAP1, teamAP2, teamBP1, teamBP2, players, allFourPicked, noDuplicates]);

  function clearPlayers() {
    setTeamAP1("");
    setTeamAP2("");
    setTeamBP1("");
    setTeamBP2("");
  }

  async function handleSubmit() {
    setSubmitError(null);
    setBanner(null);
    setSubmitting(true);

    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData?.user?.id;

    if (!currentUserId) {
      // Shouldn't normally happen — App.tsx only renders this screen once
      // signed in as an admin — but fail clearly rather than silently.
      setSubmitError("You need to be signed in to submit a match.");
      setSubmitting(false);
      return;
    }

    const { data: inserted, error } = await supabase
      .from("matches")
      .insert({
        team_a_player_1_id: teamAP1,
        team_a_player_2_id: teamAP2,
        team_b_player_1_id: teamBP1,
        team_b_player_2_id: teamBP2,
        team_a_score: Number(teamAScore),
        team_b_score: Number(teamBScore),
        submitted_by: currentUserId,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      setSubmitError(error.message);
      setSubmitting(false);
      return;
    }

    // Admins are trusted to enter correct results (per the club's existing
    // process), so there's no separate confirmation step — finalize the
    // match and update ratings right away.
    const { error: confirmError } = await supabase.functions.invoke("confirm-match", {
      body: { match_id: inserted.id },
    });

    if (confirmError) {
      // The request to reach the rating function can fail client-side
      // (e.g. a dropped connection) even when the function itself goes on
      // to finish successfully a moment later. Rather than trust the
      // failed request alone, check the match's actual status before
      // showing a scary error for something that isn't actually broken.
      const { data: recheck } = await supabase
        .from("matches")
        .select("status")
        .eq("id", inserted.id)
        .single();

      if (recheck?.status === "confirmed") {
        const a1 = byId(teamAP1)?.display_name ?? "?";
        const a2 = byId(teamAP2)?.display_name ?? "?";
        const b1 = byId(teamBP1)?.display_name ?? "?";
        const b2 = byId(teamBP2)?.display_name ?? "?";
        setBanner(`Saved — ${a1} & ${a2} ${teamAScore}–${teamBScore} ${b1} & ${b2}`);
        setTeamAScore("");
        setTeamBScore("");
        setSubmitting(false);
        loadPlayers();
        teamAScoreRef.current?.focus();
        return;
      }

      setSubmitError(
        `Match saved, but rating calculation failed: ${confirmError.message}. It's logged as pending — check with the admin who set up the app.`
      );
      setSubmitting(false);
      return;
    }

    const a1 = byId(teamAP1)?.display_name ?? "?";
    const a2 = byId(teamAP2)?.display_name ?? "?";
    const b1 = byId(teamBP1)?.display_name ?? "?";
    const b2 = byId(teamBP2)?.display_name ?? "?";
    setBanner(`Saved — ${a1} & ${a2} ${teamAScore}–${teamBScore} ${b1} & ${b2}`);

    // Keep the same four players selected — only the scores clear — so
    // entering the next game between the same group is a two-field job.
    setTeamAScore("");
    setTeamBScore("");
    setSubmitting(false);

    // Refresh ratings in the background so the win-probability prediction
    // for the next game (if it's the same players again) is accurate.
    loadPlayers();

    teamAScoreRef.current?.focus();
  }

  if (loading) return <p>Loading players…</p>;
  if (loadError)
    return (
      <p className="error">
        Couldn't load players: {loadError}. Check that the database tables
        exist (see supabase/migrations/0001_init.sql) and your .env values
        are correct.
      </p>
    );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 0 }}>Enter a match</h1>
        {allFourPicked && (
          <span className="link-action" role="button" tabIndex={0} onClick={clearPlayers}>
            Clear players
          </span>
        )}
      </div>

      {banner && (
        <div className="predicted" style={{ background: "var(--navy-900)" }}>
          {banner}
          <br />
          <span
            className="link-action"
            role="button"
            tabIndex={0}
            style={{ color: "rgba(255,255,255,0.75)" }}
            onClick={() => setBanner(null)}
          >
            dismiss
          </span>
        </div>
      )}

      <label style={{ marginTop: 24 }}>Team A</label>
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

      <label style={{ marginTop: 24 }}>Team B</label>
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

      <div className="score-row" style={{ marginTop: 24 }}>
        <div>
          <label>Team A score</label>
          <input
            ref={teamAScoreRef}
            type="number"
            min={0}
            value={teamAScore}
            onChange={(e) => setTeamAScore(e.target.value)}
          />
        </div>
        <div>
          <label>Team B score</label>
          <input
            type="number"
            min={0}
            value={teamBScore}
            onChange={(e) => setTeamBScore(e.target.value)}
          />
        </div>
      </div>

      {prediction && (
        <div className="predicted">
          Predicted: Team A wins ~
          {Math.round(prediction.teamAProbability * 100)}% of the time
          <br />
          <small>Based on current ratings and rating deviation — same math the engine uses.</small>
        </div>
      )}

      {!noDuplicates && allFourPicked && (
        <p className="error">Each player can only be selected once.</p>
      )}
      {submitError && <p className="error">{submitError}</p>}

      <button disabled={!canSubmit} onClick={handleSubmit}>
        {submitting ? "Submitting…" : "Submit match"}
      </button>
    </div>
  );
}
