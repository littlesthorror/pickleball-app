import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { PlayerSelect, submitOneMatch } from "./MatchEntry";
import { computeGroupStandings, generateGroupFixtures } from "../lib/competitionStandings";
import { getCurrentSeason, getSeasonEndInfo } from "../lib/seasons";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import PageLoading from "../components/PageLoading";
import type { QuarterlyCupRow, QuarterlyCupTeamRow, QuarterlyCupMatchRow, PlayerStatus, ScoringSystem } from "../types";

// The Quarterly Cup (2026-09-02, Ben's request) — a standalone fixed-team
// doubles mini-league, deliberately separate from Competitions (no
// knockout stage, just a flat table) and from the main Season leaderboard
// (a different, rating-based, permanent system). Teams play every other
// team twice, on whatever date suits them — there's no pre-scheduled
// kickoff, just a target finish date. Every game played here is ALSO a
// real row in `matches` (via quarterly_cup_matches.match_id), so it feeds
// the same Glicko-2 engine as any normal club match, exactly like
// Competitions. Results/fixtures are fully public (Ben confirmed this
// explicitly) — the "keep players to only what they need to play" ask is a
// UI default (participants see their own unplayed fixtures first), not an
// RLS restriction.
export default function QuarterlyCup({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [cups, setCups] = useState<QuarterlyCupRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("The Quarterly Cup");
  const [newScoring, setNewScoring] = useState<ScoringSystem>("social");
  const [newDoubleRoundRobin, setNewDoubleRoundRobin] = useState(true);
  const [newMirrorSeason, setNewMirrorSeason] = useState(true);
  const [newEndDate, setNewEndDate] = useState("");
  const [creating, setCreating] = useState(false);
  // Collapsed by default once at least one Cup exists — same reasoning as
  // Competitions' "New competition" form.
  const [showNewForm, setShowNewForm] = useState<boolean | null>(null);

  function loadCups() {
    return supabase
      .from("quarterly_cups")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          const rows = (data ?? []) as QuarterlyCupRow[];
          setCups(rows);
          setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
        }
      });
  }

  useEffect(() => {
    Promise.all([
      supabase.from("player_status").select("*").eq("is_active", true).order("display_name"),
      loadCups(),
    ]).then(([playersRes]) => {
      if (playersRes.error) setError(playersRes.error.message);
      else setPlayers((playersRes.data ?? []) as PlayerStatus[]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showNewForm === null) setShowNewForm(cups.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cups.length]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("quarterly_cups")
      .insert({
        name: newName.trim(),
        scoring_system: newScoring,
        double_round_robin: newDoubleRoundRobin,
        mirror_season_end: newMirrorSeason,
        end_date: newMirrorSeason ? null : newEndDate || null,
        created_by: currentUserId,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewName("The Quarterly Cup");
    setNewScoring("standard");
    setNewDoubleRoundRobin(true);
    setNewMirrorSeason(true);
    setNewEndDate("");
    await loadCups();
    setSelectedId(data.id);
  }

  // Cascades to teams/matches via FK — does NOT touch the underlying
  // `matches` rows those quarterly_cup_matches linked to, so games already
  // played still count toward players' normal ratings/history even after
  // the Cup record itself is removed. Same reasoning as Competitions'
  // delete.
  async function handleDelete(id: string) {
    const target = cups.find((c) => c.id === id);
    if (!target) return;
    if (!(await confirm(`Delete "${target.name}"? This removes its teams and fixtures — permanently.`, { danger: true })))
      return;
    const { error } = await supabase.from("quarterly_cups").delete().eq("id", id);
    if (error) {
      toast.error(`Couldn't delete: ${error.message}`);
      return;
    }
    setSelectedId(null);
    await loadCups();
  }

  if (loading) return <PageLoading label="Loading The Quarterly Cup…" />;

  const selected = cups.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      {error && <p className="error">{error}</p>}

      {cups.length > 1 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Quarterly Cups</h2>
          {cups.map((c) => (
            <div
              className="match-row"
              key={c.id}
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedId(c.id)}
            >
              <div>
                <div className="opponent">{c.name}</div>
                <div className="meta">{c.status}</div>
              </div>
              {c.id === selectedId && <div className="score">👀</div>}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => setShowNewForm((v) => !v)}
          >
            <h2 style={{ margin: 0 }}>New Quarterly Cup</h2>
            <span className="link-action">{showNewForm ? "Hide" : "Show"}</span>
          </div>
          {showNewForm && (
            <div style={{ marginTop: 12 }}>
              <label style={{ marginTop: 0 }}>Name</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />

              <label>Scoring</label>
              <select value={newScoring} onChange={(e) => setNewScoring(e.target.value as ScoringSystem)}>
                <option value="standard">Standard — 2 pts for a win</option>
                <option value="social">Social — losers keep 1 pt if they scored 7+</option>
              </select>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input
                  id="qc-double-rr"
                  type="checkbox"
                  checked={newDoubleRoundRobin}
                  onChange={(e) => setNewDoubleRoundRobin(e.target.checked)}
                />
                <label htmlFor="qc-double-rr" style={{ margin: 0, fontWeight: 400 }}>
                  Every team plays every other team twice
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input
                  id="qc-mirror-season"
                  type="checkbox"
                  checked={newMirrorSeason}
                  onChange={(e) => setNewMirrorSeason(e.target.checked)}
                />
                <label htmlFor="qc-mirror-season" style={{ margin: 0, fontWeight: 400 }}>
                  Finish on the Season's last day
                </label>
              </div>
              {!newMirrorSeason && (
                <>
                  <label>Finish date</label>
                  <input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} />
                </>
              )}

              <button disabled={creating || !newName.trim()} onClick={handleCreate} style={{ marginTop: 16 }}>
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          )}
        </div>
      )}

      {selected ? (
        <CupDetail
          key={selected.id}
          cup={selected}
          players={players}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onDelete={handleDelete}
          onCupChanged={loadCups}
        />
      ) : (
        <p className="stat-meta">No Quarterly Cup set up yet.</p>
      )}
    </div>
  );
}

function CupDetail({
  cup,
  players,
  isAdmin,
  currentUserId,
  onDelete,
  onCupChanged,
}: {
  cup: QuarterlyCupRow;
  players: PlayerStatus[];
  isAdmin: boolean;
  currentUserId: string;
  onDelete: (id: string) => void;
  onCupChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [teams, setTeams] = useState<QuarterlyCupTeamRow[]>([]);
  const [matches, setMatches] = useState<(QuarterlyCupMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(cup.name);
  const [savingName, setSavingName] = useState(false);

  const [editingEnd, setEditingEnd] = useState(false);
  const [mirrorDraft, setMirrorDraft] = useState(cup.mirror_season_end);
  const [endDateDraft, setEndDateDraft] = useState(cup.end_date ?? "");
  const [savingEnd, setSavingEnd] = useState(false);

  function load() {
    return Promise.all([
      supabase.from("quarterly_cup_teams").select("*").eq("cup_id", cup.id),
      supabase.from("quarterly_cup_matches").select("*, matches(team_a_score, team_b_score)").eq("cup_id", cup.id),
    ]).then(([teamsRes, matchesRes]) => {
      if (teamsRes.error) toast.error(teamsRes.error.message);
      else setTeams((teamsRes.data ?? []) as QuarterlyCupTeamRow[]);
      if (matchesRes.error) toast.error(matchesRes.error.message);
      else setMatches((matchesRes.data ?? []) as typeof matches);
      setLoading(false);
    });
  }

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cup.id]);

  async function refreshAfterChange() {
    await load();
    onCupChanged();
  }

  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p.display_name])), [players]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  function teamLabel(teamId: string): string {
    const t = teamById.get(teamId);
    if (!t) return "?";
    if (t.team_name) return t.team_name;
    return `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`;
  }

  const seasonEndInfo = useMemo(() => getSeasonEndInfo(getCurrentSeason()), []);
  const finishInfo = cup.mirror_season_end
    ? seasonEndInfo
    : cup.end_date
    ? (() => {
        const lastDay = new Date(cup.end_date + "T00:00:00");
        const daysLeft = Math.max(0, Math.ceil((lastDay.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
        return { lastDay, daysLeft };
      })()
    : null;

  async function saveName() {
    const value = nameDraft.trim();
    if (!value) {
      toast.error("Name can't be empty.");
      return;
    }
    setSavingName(true);
    const { error } = await supabase.from("quarterly_cups").update({ name: value }).eq("id", cup.id);
    setSavingName(false);
    if (error) {
      toast.error(`Couldn't rename: ${error.message}`);
      return;
    }
    setEditingName(false);
    onCupChanged();
  }

  async function saveEnd() {
    setSavingEnd(true);
    const { error } = await supabase
      .from("quarterly_cups")
      .update({ mirror_season_end: mirrorDraft, end_date: mirrorDraft ? null : endDateDraft || null })
      .eq("id", cup.id);
    setSavingEnd(false);
    if (error) {
      toast.error(`Couldn't update finish date: ${error.message}`);
      return;
    }
    setEditingEnd(false);
    onCupChanged();
  }

  const playedCount = matches.filter((m) => m.matches).length;
  const totalCount = matches.length;

  async function markComplete() {
    const standings = computeGroupStandings(
      teams.map((t) => t.id),
      matches.filter((m) => m.matches).map((m) => ({
        teamAId: m.team_a_id,
        teamBId: m.team_b_id,
        teamAScore: m.matches!.team_a_score,
        teamBScore: m.matches!.team_b_score,
      })),
      cup.scoring_system
    );
    const champion = standings[0];
    if (!champion) {
      toast.error("No games played yet — nothing to crown.");
      return;
    }
    if (
      !(await confirm(
        `Mark "${cup.name}" complete and crown ${teamLabel(champion.teamId)} champions? The table locks until you reopen it.`
      ))
    )
      return;
    const { error } = await supabase
      .from("quarterly_cups")
      .update({ status: "completed", winner_team_id: champion.teamId })
      .eq("id", cup.id);
    if (error) {
      toast.error(`Couldn't complete: ${error.message}`);
      return;
    }
    onCupChanged();
  }

  async function reopen() {
    if (!(await confirm("Reopen this Cup? It'll move back to active so results can be corrected."))) return;
    const { error } = await supabase
      .from("quarterly_cups")
      .update({ status: "active", winner_team_id: null })
      .eq("id", cup.id);
    if (error) {
      toast.error(`Couldn't reopen: ${error.message}`);
      return;
    }
    onCupChanged();
  }

  if (loading) return <PageLoading label="Loading Cup…" />;

  return (
    <div>
      <div className="card" style={{ background: "var(--navy-900)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {editingName ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  style={{
                    minWidth: 0,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.4)",
                    background: "rgba(255,255,255,0.12)",
                    color: "#fff",
                    fontSize: "1.2rem",
                    fontWeight: 700,
                  }}
                />
                <button disabled={savingName || !nameDraft.trim()} onClick={saveName} style={{ width: "auto", marginTop: 0 }}>
                  ✓
                </button>
                <button
                  disabled={savingName}
                  onClick={() => setEditingName(false)}
                  style={{ width: "auto", marginTop: 0, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)" }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <h2 style={{ margin: 0, color: "#fff", fontSize: "1.5rem", display: "flex", alignItems: "center", gap: 8 }}>
                🏅 {cup.name}
                {isAdmin && (
                  <button
                    onClick={() => {
                      setNameDraft(cup.name);
                      setEditingName(true);
                    }}
                    aria-label="Edit Cup name"
                    style={{ width: "auto", marginTop: 0, padding: "2px 6px", fontSize: "0.85rem", background: "transparent", color: "rgba(255,255,255,0.75)", border: "none" }}
                  >
                    ✏️
                  </button>
                )}
              </h2>
            )}
            {finishInfo && (
              <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,0.75)", fontSize: "0.85rem" }}>
                Completes{" "}
                {finishInfo.lastDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                {finishInfo.daysLeft > 0 ? ` · ${finishInfo.daysLeft} day${finishInfo.daysLeft === 1 ? "" : "s"} left` : ""}
                {cup.mirror_season_end ? " (mirrors the Season)" : ""}
              </p>
            )}
            {isAdmin && (
              <span
                className="link-action"
                style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.78rem", marginTop: 4, display: "block" }}
                onClick={() => {
                  setMirrorDraft(cup.mirror_season_end);
                  setEndDateDraft(cup.end_date ?? "");
                  setEditingEnd((v) => !v);
                }}
              >
                {editingEnd ? "Cancel" : "Change finish date"}
              </span>
            )}
            {editingEnd && (
              <div style={{ marginTop: 8, background: "rgba(255,255,255,0.08)", padding: 10, borderRadius: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="qc-edit-mirror"
                    type="checkbox"
                    checked={mirrorDraft}
                    onChange={(e) => setMirrorDraft(e.target.checked)}
                  />
                  <label htmlFor="qc-edit-mirror" style={{ margin: 0, fontWeight: 400, color: "#fff" }}>
                    Finish on the Season's last day
                  </label>
                </div>
                {!mirrorDraft && (
                  <input
                    type="date"
                    value={endDateDraft}
                    onChange={(e) => setEndDateDraft(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                )}
                <button disabled={savingEnd} onClick={saveEnd} style={{ width: "auto", marginTop: 8 }}>
                  {savingEnd ? "Saving…" : "Save"}
                </button>
              </div>
            )}
            <span
              style={{
                display: "inline-block",
                marginTop: 8,
                padding: "3px 10px",
                borderRadius: 999,
                background: "var(--orange-500)",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.72rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {cup.status}
            </span>
          </div>
          {isAdmin && (
            <button
              style={{ width: "auto", marginLeft: "auto", marginTop: 0, padding: "8px 14px", fontSize: "0.85rem", background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid var(--danger)" }}
              onClick={() => onDelete(cup.id)}
            >
              Delete Cup
            </button>
          )}
        </div>
      </div>

      {cup.status === "setup" && (
        <TeamsSection cup={cup} players={players} teams={teams} isAdmin={isAdmin} onChanged={refreshAfterChange} />
      )}

      {(cup.status === "active" || cup.status === "completed") && (
        <>
          <StandingsSection teams={teams} matches={matches} teamLabel={teamLabel} scoringSystem={cup.scoring_system} winnerTeamId={cup.winner_team_id} />
          <FixturesSection
            cup={cup}
            matches={matches}
            teamLabel={teamLabel}
            teams={teams}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onChanged={refreshAfterChange}
          />
          {isAdmin && (
            <div className="card">
              <p className="stat-meta" style={{ marginTop: 0 }}>
                {playedCount} of {totalCount} fixtures played.
              </p>
              {cup.status === "active" ? (
                <button onClick={markComplete}>Mark complete &amp; crown champions</button>
              ) : (
                <button
                  onClick={reopen}
                  style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
                >
                  Reopen Cup
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamsSection({
  cup,
  players,
  teams,
  isAdmin,
  onChanged,
}: {
  cup: QuarterlyCupRow;
  players: PlayerStatus[];
  teams: QuarterlyCupTeamRow[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [teamName, setTeamName] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editP1, setEditP1] = useState("");
  const [editP2, setEditP2] = useState("");
  const [editTeamName, setEditTeamName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const nameById = new Map(players.map((p) => [p.id, p.display_name]));
  const usedPlayerIds = new Set(teams.flatMap((t) => [t.player1_id, t.player2_id]));

  async function addTeam() {
    if (!p1 || !p2 || p1 === p2) return;
    setSaving(true);
    const { error } = await supabase.from("quarterly_cup_teams").insert({
      cup_id: cup.id,
      player1_id: p1,
      player2_id: p2,
      team_name: teamName.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(`Couldn't add team: ${error.message}`);
      return;
    }
    setP1("");
    setP2("");
    setTeamName("");
    onChanged();
  }

  function startEdit(t: QuarterlyCupTeamRow) {
    setEditingTeamId(t.id);
    setEditP1(t.player1_id);
    setEditP2(t.player2_id);
    setEditTeamName(t.team_name ?? "");
  }

  async function saveEdit(teamId: string) {
    if (!editP1 || !editP2 || editP1 === editP2) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from("quarterly_cup_teams")
      .update({ player1_id: editP1, player2_id: editP2, team_name: editTeamName.trim() || null })
      .eq("id", teamId);
    setSavingEdit(false);
    if (error) {
      toast.error(`Couldn't save: ${error.message}`);
      return;
    }
    setEditingTeamId(null);
    onChanged();
  }

  async function deleteTeam(teamId: string) {
    if (!(await confirm("Remove this team?", { danger: true }))) return;
    const { error } = await supabase.from("quarterly_cup_teams").delete().eq("id", teamId);
    if (error) {
      toast.error(`Couldn't remove team: ${error.message}`);
      return;
    }
    onChanged();
  }

  async function startCup() {
    setStartError(null);
    if (teams.length < 2) {
      setStartError("Add at least 2 teams first.");
      return;
    }
    if (
      !(await confirm(
        `Start "${cup.name}"? This generates the full fixture list for ${teams.length} teams — you can still add results as you go, but teams lock once started.`
      ))
    )
      return;
    setStarting(true);

    const fixtureRows = generateGroupFixtures(
      teams.map((t) => t.id),
      cup.double_round_robin
    ).map((f) => ({ cup_id: cup.id, team_a_id: f.teamAId, team_b_id: f.teamBId, leg: f.leg }));

    const { error: fixtureError } = await supabase.from("quarterly_cup_matches").insert(fixtureRows);
    if (fixtureError) {
      setStartError(fixtureError.message);
      setStarting(false);
      return;
    }
    const { error: statusError } = await supabase.from("quarterly_cups").update({ status: "active" }).eq("id", cup.id);
    setStarting(false);
    if (statusError) {
      setStartError(statusError.message);
      return;
    }
    onChanged();
  }

  if (!isAdmin) {
    return <p className="stat-meta">This Quarterly Cup is still being set up by an admin.</p>;
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Teams ({teams.length})</h3>
        {teams.map((t) =>
          editingTeamId === t.id ? (
            <div key={t.id} className="match-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <PlayerSelect
                label="Player 1"
                players={players}
                value={editP1}
                onChange={setEditP1}
                disabledIds={[...usedPlayerIds].filter((id) => id !== t.player1_id && id !== t.player2_id)}
              />
              <PlayerSelect
                label="Player 2"
                players={players}
                value={editP2}
                onChange={setEditP2}
                disabledIds={[...usedPlayerIds].filter((id) => id !== t.player1_id && id !== t.player2_id)}
              />
              <label>Team name (optional)</label>
              <input type="text" value={editTeamName} onChange={(e) => setEditTeamName(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={savingEdit} onClick={() => saveEdit(t.id)}>
                  Save
                </button>
                <button
                  disabled={savingEdit}
                  onClick={() => setEditingTeamId(null)}
                  style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="match-row" key={t.id}>
              <div className="opponent">
                {t.team_name || `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <span className="link-action" onClick={() => startEdit(t)}>
                  Edit
                </span>
                <span className="link-action" onClick={() => deleteTeam(t.id)}>
                  Remove
                </span>
              </div>
            </div>
          )
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add a team</h3>
        <PlayerSelect label="Player 1" players={players} value={p1} onChange={setP1} disabledIds={[...usedPlayerIds]} />
        <PlayerSelect label="Player 2" players={players} value={p2} onChange={setP2} disabledIds={[...usedPlayerIds]} />
        <label>Team name (optional)</label>
        <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. The Dinkers" />
        <button disabled={saving || !p1 || !p2 || p1 === p2} onClick={addTeam} style={{ marginTop: 12 }}>
          {saving ? "Adding…" : "Add team"}
        </button>
      </div>

      <div className="card">
        {startError && <p className="error">{startError}</p>}
        <button disabled={starting || teams.length < 2} onClick={startCup}>
          {starting ? "Starting…" : "Start Cup — generate fixtures"}
        </button>
      </div>
    </div>
  );
}

function StandingsSection({
  teams,
  matches,
  teamLabel,
  scoringSystem,
  winnerTeamId,
}: {
  teams: QuarterlyCupTeamRow[];
  matches: (QuarterlyCupMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  scoringSystem: ScoringSystem;
  winnerTeamId: string | null;
}) {
  const standings = computeGroupStandings(
    teams.map((t) => t.id),
    matches
      .filter((m) => m.matches)
      .map((m) => ({ teamAId: m.team_a_id, teamBId: m.team_b_id, teamAScore: m.matches!.team_a_score, teamBScore: m.matches!.team_b_score })),
    scoringSystem
  );

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Table</h3>
      {winnerTeamId && (
        <p className="stat-meta" style={{ marginTop: 0, marginBottom: 12 }}>
          🏆 Champions: <strong style={{ color: "var(--heading)" }}>{teamLabel(winnerTeamId)}</strong>
        </p>
      )}
      {standings.map((row, i) => (
        <div className="leaderboard-row" key={row.teamId}>
          <span className={`rank ${i < 3 ? "top3" : ""}`}>{i + 1}</span>
          <span className="name">{teamLabel(row.teamId)}</span>
          <span className="stat-meta" style={{ marginTop: 0, width: 70, textAlign: "right" }}>
            {row.played}p {row.won}w
          </span>
          <span className="rating">{row.pts}</span>
        </div>
      ))}
    </div>
  );
}

function FixturesSection({
  cup,
  matches,
  teamLabel,
  teams,
  isAdmin,
  currentUserId,
  onChanged,
}: {
  cup: QuarterlyCupRow;
  matches: (QuarterlyCupMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  teams: QuarterlyCupTeamRow[];
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  // Which fixtures the signed-in viewer is actually on a team for — used to
  // default non-admins to "what do I still need to play" rather than the
  // full list. Admins always start on "show all" since they're managing
  // the whole thing.
  const myTeamIds = new Set(teams.filter((t) => t.player1_id === currentUserId || t.player2_id === currentUserId).map((t) => t.id));
  const [showAll, setShowAll] = useState(isAdmin || myTeamIds.size === 0);

  const visibleMatches = showAll
    ? matches
    : matches.filter((m) => myTeamIds.has(m.team_a_id) || myTeamIds.has(m.team_b_id));

  const unplayed = visibleMatches.filter((m) => !m.matches);
  const played = visibleMatches.filter((m) => m.matches);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>Fixtures</h3>
        {myTeamIds.size > 0 && (
          <span className="link-action" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show just my fixtures" : "Show all fixtures"}
          </span>
        )}
      </div>
      {!showAll && (
        <p className="stat-meta" style={{ marginBottom: 12 }}>
          Only your own outstanding games — everything's still visible to everyone via "Show all fixtures".
        </p>
      )}
      {unplayed.length === 0 && played.length === 0 && <p className="stat-meta">No fixtures to show.</p>}
      {unplayed.map((m) => (
        <FixtureRow key={m.id} match={m} teamLabel={teamLabel} isAdmin={isAdmin} currentUserId={currentUserId} onChanged={onChanged} locked={cup.status === "completed"} />
      ))}
      {played.map((m) => (
        <FixtureRow key={m.id} match={m} teamLabel={teamLabel} isAdmin={isAdmin} currentUserId={currentUserId} onChanged={onChanged} locked={cup.status === "completed"} />
      ))}
    </div>
  );
}

function FixtureRow({
  match,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
  locked,
}: {
  match: QuarterlyCupMatchRow & { matches: { team_a_score: number; team_b_score: number } | null };
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
  locked: boolean;
}) {
  const confirm = useConfirm();
  const played = !!match.matches;
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function startEdit() {
    setScoreA(String(match.matches!.team_a_score));
    setScoreB(String(match.matches!.team_b_score));
    setError(null);
    setEditing(true);
  }

  async function saveEdit() {
    const teamAScore = Number(scoreA);
    const teamBScore = Number(scoreB);
    if (scoreA === "" || scoreB === "" || teamAScore < 0 || teamBScore < 0 || teamAScore === teamBScore) {
      setError("Enter both scores (they can't be equal).");
      return;
    }
    if (!match.match_id) {
      setError("Couldn't find the linked match to edit.");
      return;
    }
    if (!(await confirm(`Change the score to ${teamAScore}–${teamBScore}? Ratings get recalculated afterward.`))) return;
    setSubmitting(true);
    setError(null);
    const { error: editError } = await supabase.functions.invoke("edit-match", {
      body: { match_id: match.match_id, team_a_score: teamAScore, team_b_score: teamBScore },
    });
    setSubmitting(false);
    if (editError) {
      setError(`Score saved, but recalculation may still be finishing: ${editError.message}`);
      return;
    }
    const winnerTeamId = teamAScore > teamBScore ? match.team_a_id : match.team_b_id;
    await supabase.from("quarterly_cup_matches").update({ winner_team_id: winnerTeamId }).eq("id", match.id);
    setEditing(false);
    onChanged();
  }

  async function submit() {
    if (scoreA === "" || scoreB === "" || Number(scoreA) < 0 || Number(scoreB) < 0 || Number(scoreA) === Number(scoreB)) {
      setError("Enter both scores (they can't be equal).");
      return;
    }
    setSubmitting(true);
    setError(null);

    const teamsRes = await supabase
      .from("quarterly_cup_teams")
      .select("id, player1_id, player2_id")
      .in("id", [match.team_a_id, match.team_b_id]);
    const teamA = teamsRes.data?.find((t) => t.id === match.team_a_id);
    const teamB = teamsRes.data?.find((t) => t.id === match.team_b_id);
    if (!teamA || !teamB) {
      setError("Couldn't load team rosters.");
      setSubmitting(false);
      return;
    }

    const result = await submitOneMatch({
      teamAP1: teamA.player1_id,
      teamAP2: teamA.player2_id,
      teamBP1: teamB.player1_id,
      teamBP2: teamB.player2_id,
      teamAScore: scoreA,
      teamBScore: scoreB,
      currentUserId,
    });

    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      setSubmitting(false);
      return;
    }

    // Need the just-created match's id to link it — re-query the most
    // recent confirmed match between exactly these 4 players, same
    // approach Competitions' fixture entry uses.
    const { data: recentMatch } = await supabase
      .from("matches")
      .select("id")
      .eq("team_a_player_1_id", teamA.player1_id)
      .eq("team_a_player_2_id", teamA.player2_id)
      .eq("team_b_player_1_id", teamB.player1_id)
      .eq("team_b_player_2_id", teamB.player2_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const winnerTeamId = Number(scoreA) > Number(scoreB) ? match.team_a_id : match.team_b_id;

    const { error: linkError } = await supabase
      .from("quarterly_cup_matches")
      .update({ match_id: recentMatch?.id ?? null, winner_team_id: winnerTeamId })
      .eq("id", match.id);

    setSubmitting(false);
    if (linkError) {
      setError(linkError.message);
      return;
    }
    onChanged();
  }

  return (
    <div className="match-row" style={{ flexDirection: played && !editing ? "row" : "column", alignItems: played && !editing ? "center" : "stretch", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
        <div>
          <div className="opponent">
            {teamLabel(match.team_a_id)} vs {teamLabel(match.team_b_id)}
          </div>
          {match.leg === 2 && <div className="meta">2nd meeting</div>}
        </div>
        {played && !editing && (
          <div style={{ textAlign: "right" }}>
            <div className="score">
              {match.matches!.team_a_score}–{match.matches!.team_b_score}
            </div>
            {isAdmin && !locked && (
              <span className="link-action" style={{ fontSize: "0.78rem" }} onClick={startEdit}>
                Edit
              </span>
            )}
          </div>
        )}
      </div>
      {(!played || editing) && isAdmin && !locked && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={scoreA}
            onChange={(e) => setScoreA(e.target.value)}
            style={{ width: 56, padding: "6px 8px" }}
          />
          <span>–</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={scoreB}
            onChange={(e) => setScoreB(e.target.value)}
            style={{ width: 56, padding: "6px 8px" }}
          />
          <button disabled={submitting} onClick={editing ? saveEdit : submit} style={{ width: "auto" }}>
            {submitting ? "Saving…" : "Save"}
          </button>
          {editing && (
            <button
              disabled={submitting}
              onClick={() => setEditing(false)}
              style={{ width: "auto", background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 0 }}>{error}</p>}
    </div>
  );
}
