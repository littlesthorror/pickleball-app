import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { averageTeam, predictedWinProbability } from "../lib/predict";
import type { PlayerStatus } from "../types";

export function PlayerSelect({
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

// Shared by both entry modes (and by Competitions.tsx, for group-stage /
// knockout results) — inserts one match row and confirms it via the
// confirm-match edge function, with the same "recheck the actual status
// before showing a scary error" false-failure handling used throughout the
// app for edge function calls.
export async function submitOneMatch(match: {
  teamAP1: string;
  teamAP2: string;
  teamBP1: string;
  teamBP2: string;
  teamAScore: string;
  teamBScore: string;
  currentUserId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: inserted, error } = await supabase
    .from("matches")
    .insert({
      team_a_player_1_id: match.teamAP1,
      team_a_player_2_id: match.teamAP2,
      team_b_player_1_id: match.teamBP1,
      team_b_player_2_id: match.teamBP2,
      team_a_score: Number(match.teamAScore),
      team_b_score: Number(match.teamBScore),
      submitted_by: match.currentUserId,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  const { error: confirmError } = await supabase.functions.invoke("confirm-match", {
    body: { match_id: inserted.id },
  });

  if (confirmError) {
    const { data: recheck } = await supabase
      .from("matches")
      .select("status")
      .eq("id", inserted.id)
      .single();

    if (recheck?.status === "confirmed") {
      return { ok: true };
    }

    return {
      ok: false,
      error: `Match saved, but rating calculation failed: ${confirmError.message}. It's logged as pending.`,
    };
  }

  return { ok: true };
}

type Mode = "single" | "quick";

export default function MatchEntry() {
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("single");

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ marginBottom: 0 }}>Enter a match</h1>
        {/* Added 2026-08-26 at Ben's request — Quick entry is for busy
            sessions where several games need logging back-to-back-to-back;
            Single entry stays exactly as it was (same 4 players, auto-focus
            on score after each submit) for the normal one-at-a-time case. */}
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <button
            onClick={() => setMode("single")}
            style={{
              marginTop: 0,
              borderRadius: 0,
              width: "auto",
              padding: "8px 16px",
              fontSize: "0.85rem",
              background: mode === "single" ? "var(--orange-500)" : "transparent",
              color: mode === "single" ? "#fff" : "var(--navy-500)",
            }}
          >
            Single entry
          </button>
          <button
            onClick={() => setMode("quick")}
            style={{
              marginTop: 0,
              borderRadius: 0,
              width: "auto",
              padding: "8px 16px",
              fontSize: "0.85rem",
              background: mode === "quick" ? "var(--orange-500)" : "transparent",
              color: mode === "quick" ? "#fff" : "var(--navy-500)",
            }}
          >
            Quick entry (×4)
          </button>
        </div>
      </div>

      {mode === "single" ? (
        <SingleMatchEntry players={players} onPlayersChanged={loadPlayers} />
      ) : (
        <QuickMatchEntry players={players} onPlayersChanged={loadPlayers} />
      )}
    </div>
  );
}

function SingleMatchEntry({
  players,
  onPlayersChanged,
}: {
  players: PlayerStatus[];
  onPlayersChanged: () => void;
}) {
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

    const result = await submitOneMatch({
      teamAP1,
      teamAP2,
      teamBP1,
      teamBP2,
      teamAScore,
      teamBScore,
      currentUserId,
    });

    if (!result.ok) {
      setSubmitError(result.error ?? "Something went wrong submitting this match.");
      setSubmitting(false);
      return;
    }

    const a1 = byId(teamAP1)?.display_name ?? "?";
    const a2 = byId(teamAP2)?.display_name ?? "?";
    const b1 = byId(teamBP1)?.display_name ?? "?";
    const b2 = byId(teamBP2)?.display_name ?? "?";
    setBanner(`Match confirmed — ${a1} & ${a2} ${teamAScore}–${teamBScore} ${b1} & ${b2}`);

    // Keep the same four players selected — only the scores clear — so
    // entering the next game between the same group is a two-field job.
    setTeamAScore("");
    setTeamBScore("");
    setSubmitting(false);

    // Refresh ratings in the background so the win-probability prediction
    // for the next game (if it's the same players again) is accurate.
    onPlayersChanged();

    teamAScoreRef.current?.focus();
  }

  return (
    <div>
      {allFourPicked && (
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <span className="link-action" role="button" tabIndex={0} onClick={clearPlayers}>
            Clear players
          </span>
        </div>
      )}

      {banner && (
        <div className="predicted" style={{ background: "var(--orange-500)" }}>
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

interface GameSlot {
  teamAP1: string;
  teamAP2: string;
  teamBP1: string;
  teamBP2: string;
  teamAScore: string;
  teamBScore: string;
  status: "idle" | "success" | "error";
  error?: string;
}

function emptySlot(): GameSlot {
  return {
    teamAP1: "",
    teamAP2: "",
    teamBP1: "",
    teamBP2: "",
    teamAScore: "",
    teamBScore: "",
    status: "idle",
  };
}

const QUICK_SLOT_COUNT = 4;

// Lets an admin fill in up to 4 games — each with its own 4 players and
// score — then submit them all in one go, instead of doing the
// insert-and-wait cycle 4 separate times. Added 2026-08-26 at Ben's
// request, specifically for busy sessions where several games need
// logging back-to-back.
//
// Submission is deliberately sequential (one match fully confirmed before
// the next starts), NOT parallel — this matters because Glicko-2 rating
// updates depend on each player's rating going INTO that game, so if the
// same player appears in more than one slot (e.g. games 1 and 3 are the
// same four people), game 3 needs to see the rating change from game 1
// already applied. Submitting in parallel would silently produce wrong
// numbers for exactly the "same group, several games in a row" case this
// mode exists for.
function QuickMatchEntry({
  players,
  onPlayersChanged,
}: {
  players: PlayerStatus[];
  onPlayersChanged: () => void;
}) {
  const [slots, setSlots] = useState<GameSlot[]>(() =>
    Array.from({ length: QUICK_SLOT_COUNT }, emptySlot)
  );
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const byId = (id: string) => players.find((p) => p.id === id);

  function updateSlot(index: number, patch: Partial<GameSlot>) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch, status: "idle", error: undefined } : s)));
  }

  function clearSlot(index: number) {
    setSlots((prev) => prev.map((s, i) => (i === index ? emptySlot() : s)));
  }

  function copyPlayersFromFirst(index: number) {
    const first = slots[0];
    setSlots((prev) =>
      prev.map((s, i) =>
        i === index
          ? { ...s, teamAP1: first.teamAP1, teamAP2: first.teamAP2, teamBP1: first.teamBP1, teamBP2: first.teamBP2, status: "idle", error: undefined }
          : s
      )
    );
  }

  function slotValidity(slot: GameSlot) {
    const selectedIds = [slot.teamAP1, slot.teamAP2, slot.teamBP1, slot.teamBP2].filter(Boolean);
    const isEmpty = selectedIds.length === 0 && slot.teamAScore === "" && slot.teamBScore === "";
    const allFourPicked = selectedIds.length === 4;
    const noDuplicates = new Set(selectedIds).size === selectedIds.length;
    const scoresValid =
      slot.teamAScore !== "" &&
      slot.teamBScore !== "" &&
      Number(slot.teamAScore) >= 0 &&
      Number(slot.teamBScore) >= 0;
    return {
      isEmpty,
      isComplete: allFourPicked && noDuplicates && scoresValid,
      noDuplicates: noDuplicates || selectedIds.length === 0,
    };
  }

  const filledCount = slots.filter((s) => !slotValidity(s).isEmpty).length;
  const readyCount = slots.filter((s) => slotValidity(s).isComplete).length;

  async function handleSubmitAll() {
    setSummary(null);
    setSubmitting(true);

    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData?.user?.id;

    if (!currentUserId) {
      setSummary("You need to be signed in to submit matches.");
      setSubmitting(false);
      return;
    }

    let succeeded = 0;
    let failed = 0;
    let skippedIncomplete = 0;

    // Sequential on purpose — see the component-level comment above.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const validity = slotValidity(slot);

      if (validity.isEmpty) continue;

      if (!validity.isComplete) {
        skippedIncomplete++;
        setSlots((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "error", error: !validity.noDuplicates ? "Each player can only be selected once." : "Pick all 4 players and both scores." }
              : s
          )
        );
        continue;
      }

      const result = await submitOneMatch({
        teamAP1: slot.teamAP1,
        teamAP2: slot.teamAP2,
        teamBP1: slot.teamBP1,
        teamBP2: slot.teamBP2,
        teamAScore: slot.teamAScore,
        teamBScore: slot.teamBScore,
        currentUserId,
      });

      if (result.ok) {
        succeeded++;
        setSlots((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, teamAScore: "", teamBScore: "", status: "success" } : s))
        );
      } else {
        failed++;
        setSlots((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "error", error: result.error } : s))
        );
      }
    }

    const parts: string[] = [];
    if (succeeded > 0) parts.push(`${succeeded} game${succeeded === 1 ? "" : "s"} confirmed`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (skippedIncomplete > 0) parts.push(`${skippedIncomplete} incomplete (not submitted)`);
    setSummary(parts.length > 0 ? parts.join(" · ") : "Nothing to submit — fill in at least one game.");

    setSubmitting(false);
    if (succeeded > 0) onPlayersChanged();
  }

  return (
    <div>
      <p className="stat-meta" style={{ marginTop: 8 }}>
        Fill in as many of the {QUICK_SLOT_COUNT} games below as you have, then submit them all at once. They're
        confirmed in order (Game 1 first), so ratings stay correct even if the same four players show up in more
        than one game here.
      </p>

      {summary && (
        <div className="predicted" style={{ background: "var(--orange-500)" }}>
          {summary}
          <br />
          <span
            className="link-action"
            role="button"
            tabIndex={0}
            style={{ color: "rgba(255,255,255,0.75)" }}
            onClick={() => setSummary(null)}
          >
            dismiss
          </span>
        </div>
      )}

      {slots.map((slot, index) => {
        const selectedIds = [slot.teamAP1, slot.teamAP2, slot.teamBP1, slot.teamBP2].filter(Boolean);
        const { isComplete, noDuplicates } = slotValidity(slot);

        return (
          <div
            key={index}
            className="card"
            style={{
              marginTop: 16,
              borderColor: slot.status === "success" ? "var(--success)" : slot.status === "error" ? "var(--danger)" : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ marginTop: 0, marginBottom: 0, fontSize: "1rem" }}>
                Game {index + 1}
                {slot.status === "success" && <span style={{ color: "var(--success)" }}> ✓ confirmed</span>}
              </h2>
              <div style={{ display: "flex", gap: 12 }}>
                {index > 0 && (
                  <span className="link-action" role="button" tabIndex={0} onClick={() => copyPlayersFromFirst(index)}>
                    Copy Game 1 players
                  </span>
                )}
                <span className="link-action" role="button" tabIndex={0} onClick={() => clearSlot(index)}>
                  Clear
                </span>
              </div>
            </div>

            <label style={{ marginTop: 16 }}>Team A</label>
            <PlayerSelect
              label="Player 1"
              players={players}
              value={slot.teamAP1}
              onChange={(id) => updateSlot(index, { teamAP1: id })}
              disabledIds={selectedIds.filter((id) => id !== slot.teamAP1)}
            />
            <PlayerSelect
              label="Player 2"
              players={players}
              value={slot.teamAP2}
              onChange={(id) => updateSlot(index, { teamAP2: id })}
              disabledIds={selectedIds.filter((id) => id !== slot.teamAP2)}
            />

            <label style={{ marginTop: 16 }}>Team B</label>
            <PlayerSelect
              label="Player 1"
              players={players}
              value={slot.teamBP1}
              onChange={(id) => updateSlot(index, { teamBP1: id })}
              disabledIds={selectedIds.filter((id) => id !== slot.teamBP1)}
            />
            <PlayerSelect
              label="Player 2"
              players={players}
              value={slot.teamBP2}
              onChange={(id) => updateSlot(index, { teamBP2: id })}
              disabledIds={selectedIds.filter((id) => id !== slot.teamBP2)}
            />

            <div className="score-row" style={{ marginTop: 16 }}>
              <div>
                <label>Team A score</label>
                <input
                  type="number"
                  min={0}
                  value={slot.teamAScore}
                  onChange={(e) => updateSlot(index, { teamAScore: e.target.value })}
                />
              </div>
              <div>
                <label>Team B score</label>
                <input
                  type="number"
                  min={0}
                  value={slot.teamBScore}
                  onChange={(e) => updateSlot(index, { teamBScore: e.target.value })}
                />
              </div>
            </div>

            {!noDuplicates && <p className="error">Each player can only be selected once.</p>}
            {slot.status === "error" && slot.error && <p className="error">{slot.error}</p>}
            {selectedIds.length > 0 && isComplete && (
              <p className="stat-meta">
                {byId(slot.teamAP1)?.display_name} & {byId(slot.teamAP2)?.display_name} vs{" "}
                {byId(slot.teamBP1)?.display_name} & {byId(slot.teamBP2)?.display_name}
              </p>
            )}
          </div>
        );
      })}

      <p className="stat-meta" style={{ marginTop: 16 }}>
        {filledCount === 0
          ? "No games filled in yet."
          : `${readyCount} of ${filledCount} filled-in game${filledCount === 1 ? "" : "s"} ready to submit.`}
      </p>

      <button disabled={submitting || readyCount === 0} onClick={handleSubmitAll}>
        {submitting ? "Submitting…" : `Submit ${readyCount || ""} game${readyCount === 1 ? "" : "s"}`.trim()}
      </button>
    </div>
  );
}
