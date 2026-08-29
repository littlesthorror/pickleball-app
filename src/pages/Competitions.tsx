import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { PlayerSelect, submitOneMatch } from "./MatchEntry";
import { computeGroupStandings, generateGroupFixtures } from "../lib/competitionStandings";
import compBanner1 from "../assets/competition-banners/comp-banner-1.jpg";
import compBanner2 from "../assets/competition-banners/comp-banner-2.jpg";
import compBanner3 from "../assets/competition-banners/comp-banner-3.jpg";
import type {
  CompetitionRow,
  CompetitionTeamRow,
  CompetitionGroupRow,
  CompetitionGroupTeamRow,
  CompetitionMatchRow,
  KnockoutRound,
  PlayerStatus,
  ScoringSystem,
} from "../types";

const KNOCKOUT_ROUNDS: { value: KnockoutRound; label: string }[] = [
  { value: "quarterfinal", label: "Quarterfinal" },
  { value: "semifinal", label: "Semifinal" },
  { value: "third_place", label: "3rd place playoff" },
  { value: "final", label: "Final" },
];

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

// Rotating banner backdrop photos (2026-08-29, Ben's request) — the 1st
// competition ever created uses photo 1, the 2nd uses photo 2, the 3rd
// photo 3, the 4th back to photo 1, and so on — cycling purely by creation
// order so the same competition always gets the same photo rather than it
// changing depending on which one you're viewing when.
const COMPETITION_BANNERS = [compBanner1, compBanner2, compBanner3];

// Fixed-team doubles competitions: group stage (round robin within small
// groups) followed by a knockout bracket, World-Cup style. Added
// 2026-08-26 at Ben's request. Every game played here is ALSO a real row
// in the `matches` table (via competition_matches.match_id), so it feeds
// the same Glicko-2 rating engine as any normal club match — this page is
// only responsible for team/group/bracket bookkeeping and simple
// win/loss/points standings, not ratings.
export default function Competitions({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newAdvance, setNewAdvance] = useState("2");
  const [newScoring, setNewScoring] = useState<ScoringSystem>("standard");
  const [newDoubleRoundRobin, setNewDoubleRoundRobin] = useState(false);
  const [creating, setCreating] = useState(false);
  // Collapsed by default once at least one competition exists (2026-08-28,
  // Ben's request — the form was always taking up space at the top of the
  // page even when there was nothing to create). Still open by default the
  // very first time, so a brand-new club isn't stuck looking for a hidden
  // button with zero competitions on screen. Set once on mount rather than
  // recomputed on every competitions.length change, so it doesn't yank
  // itself shut/open under an admin who's mid-edit.
  const [showNewForm, setShowNewForm] = useState<boolean | null>(null);

  function loadCompetitions() {
    return supabase
      .from("competitions")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          const rows = (data ?? []) as CompetitionRow[];
          setCompetitions(rows);
          setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
        }
      });
  }

  useEffect(() => {
    Promise.all([
      supabase.from("player_status").select("*").eq("is_active", true).order("display_name"),
      loadCompetitions(),
    ]).then(([playersRes]) => {
      if (playersRes.error) setError(playersRes.error.message);
      else setPlayers((playersRes.data ?? []) as PlayerStatus[]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: newName.trim(),
        event_date: newDate || null,
        advance_per_group: Number(newAdvance) || 2,
        scoring_system: newScoring,
        double_round_robin: newDoubleRoundRobin,
        created_by: currentUserId,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewName("");
    setNewDate("");
    setNewAdvance("2");
    setNewScoring("standard");
    setNewDoubleRoundRobin(false);
    await loadCompetitions();
    setSelectedId(data.id);
  }

  // Deletes a competition outright. The competitions table's child tables
  // (teams, groups, matches, results) all use `on delete cascade` FKs, so
  // this single delete cleans up everything with no orphaned rows — it
  // does NOT touch the underlying `matches` rows those competition_matches
  // linked to, so games already played still count toward players' normal
  // ratings/history even after the competition record itself is removed.
  // Added 2026-08-26 after Ben couldn't find a way to remove a test
  // competition.
  async function handleDeleteCompetition(id: string) {
    const target = competitions.find((c) => c.id === id);
    if (!target) return;
    if (!confirm(`Delete "${target.name}"? This removes its teams, groups, and bracket — permanently.`)) return;
    const { error } = await supabase.from("competitions").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setSelectedId((prev) => (prev === id ? null : prev));
    await loadCompetitions();
  }

  const selected = competitions.find((c) => c.id === selectedId) ?? null;
  const newFormOpen = showNewForm ?? competitions.length === 0;

  if (loading) return <p>Loading competitions…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Competitions</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Fixed-team doubles competitions — group stage, then a knockout bracket. Results here count toward
        everyone's normal club rating too.
      </p>

      {competitions.length > 1 && (
        <div className="card">
          <label style={{ marginTop: 0 }}>Viewing</label>
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {isAdmin && (
        <div className="card">
          {/* Collapsible (2026-08-28, Ben's request) — collapsed by default
              once at least one competition already exists, so this form
              doesn't permanently take up space at the top of the page.
              Still expanded by default the very first time (no competitions
              yet), so there's nothing to hunt for on a brand-new club. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowNewForm(!newFormOpen)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
          >
            <h2 style={{ margin: 0 }}>New competition</h2>
            <span style={{ color: "var(--navy-500)", fontWeight: 700 }}>{newFormOpen ? "Hide ▲" : "Show ▼"}</span>
          </div>
          {newFormOpen && (
            <>
              <label>Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Huntingdon Cup 2026"
              />
              <label>Date (optional)</label>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <label>Teams advancing per group</label>
              <input
                type="number"
                min={1}
                value={newAdvance}
                onChange={(e) => setNewAdvance(e.target.value)}
                style={{ maxWidth: 100 }}
              />
              <label>Scoring system</label>
              <select value={newScoring} onChange={(e) => setNewScoring(e.target.value as ScoringSystem)}>
                <option value="standard">Standard — 2 points for a win</option>
                <option value="social">Social — 2 for a win, +1 consolation point for a close loss (7+)</option>
              </select>
              <p className="stat-meta" style={{ marginTop: 4 }}>
                {newScoring === "social"
                  ? "The losing team still picks up 1 point if they scored more than 6 in the game."
                  : "Only the winning team scores group-stage points."}
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={newDoubleRoundRobin}
                  onChange={(e) => setNewDoubleRoundRobin(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Teams play each other twice (double round robin)
              </label>
              <button disabled={creating || !newName.trim()} onClick={handleCreate} style={{ marginTop: 16 }}>
                {creating ? "Creating…" : "Create competition"}
              </button>
            </>
          )}
        </div>
      )}

      {!selected && (
        <p className="stat-meta">
          {isAdmin ? "Create your first competition above." : "No competitions have been set up yet."}
        </p>
      )}

      {selected && (
        <CompetitionDetail
          key={selected.id}
          competition={selected}
          players={players}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onCompetitionChanged={loadCompetitions}
          onDelete={handleDeleteCompetition}
          bannerIndex={
            // competitions is loaded newest-first — reverse the position to
            // get creation order (oldest = 0) before cycling through the
            // banner photos, so a given competition's photo never changes
            // as new ones get created after it.
            (competitions.length - 1 - competitions.findIndex((c) => c.id === selected.id)) % COMPETITION_BANNERS.length
          }
        />
      )}
    </div>
  );
}

function CompetitionDetail({
  competition,
  players,
  isAdmin,
  currentUserId,
  onCompetitionChanged,
  onDelete,
  bannerIndex,
}: {
  competition: CompetitionRow;
  players: PlayerStatus[];
  isAdmin: boolean;
  currentUserId: string;
  onCompetitionChanged: () => void;
  onDelete: (id: string) => void;
  bannerIndex: number;
}) {
  const [teams, setTeams] = useState<CompetitionTeamRow[]>([]);
  const [groups, setGroups] = useState<CompetitionGroupRow[]>([]);
  const [groupTeams, setGroupTeams] = useState<CompetitionGroupTeamRow[]>([]);
  const [matches, setMatches] = useState<(CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether the first load for this competition has finished. Every
  // admin action on this page (add a team, enter a score, advance a stage…)
  // calls load() again via onChanged — previously that re-set `loading` to
  // true every time, which collapsed this whole section down to a single
  // "Loading competition…" line and back, snapping the page's scroll
  // position to the top (2026-08-28 bugfix, Ben: "it shifts the page back
  // to the top... every time"). Only the very first load should show that
  // skeleton; every refresh after that updates the data in place without
  // unmounting the page.
  const hasLoadedOnce = useRef(false);

  function load() {
    if (!hasLoadedOnce.current) setLoading(true);
    return Promise.all([
      supabase.from("competition_teams").select("*").eq("competition_id", competition.id),
      supabase.from("competition_groups").select("*").eq("competition_id", competition.id).order("sort_order"),
      supabase
        .from("competition_matches")
        .select("*, matches(team_a_score, team_b_score)")
        .eq("competition_id", competition.id),
    ]).then(async ([teamsRes, groupsRes, matchesRes]) => {
      if (teamsRes.error) setError(teamsRes.error.message);
      else setTeams((teamsRes.data ?? []) as CompetitionTeamRow[]);

      if (groupsRes.error) setError(groupsRes.error.message);
      else setGroups((groupsRes.data ?? []) as CompetitionGroupRow[]);

      if (matchesRes.error) setError(matchesRes.error.message);
      else setMatches((matchesRes.data ?? []) as typeof matches);

      const groupIds = (groupsRes.data ?? []).map((g) => g.id);
      if (groupIds.length > 0) {
        const { data: gt, error: gtError } = await supabase
          .from("competition_group_teams")
          .select("*")
          .in("group_id", groupIds);
        if (gtError) setError(gtError.message);
        else setGroupTeams((gt ?? []) as CompetitionGroupTeamRow[]);
      } else {
        setGroupTeams([]);
      }

      setLoading(false);
      hasLoadedOnce.current = true;
    });
  }

  useEffect(() => {
    hasLoadedOnce.current = false;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition.id]);

  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p.display_name])), [players]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  function teamLabel(teamId: string): string {
    const t = teamById.get(teamId);
    if (!t) return "?";
    if (t.team_name) return t.team_name;
    return `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`;
  }

  async function refreshAfterChange() {
    await load();
    onCompetitionChanged();
  }

  if (loading) return <p>Loading competition…</p>;

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {/* Title banner — made bold/gradient 2026-08-27 at Ben's request
          ("50s v 18 just doesn't really pop"). 2026-08-29: now an opaque
          photo backdrop (one of 3, rotating per competition — see
          COMPETITION_BANNERS above) with the same navy gradient layered on
          top as a translucent wash, rather than a flat colour, so the
          banner still reads as a consistent "special moment" treatment
          while varying in look from one competition to the next. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          backgroundColor: "var(--navy-900)",
          backgroundImage: `linear-gradient(135deg, rgba(15,37,71,0.82), rgba(22,52,96,0.82)), url(${COMPETITION_BANNERS[bannerIndex]})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          borderRadius: "var(--radius-md)",
          padding: "18px 20px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: "1.5rem", lineHeight: 1.2 }}>
            🏆 {competition.name}
          </h2>
          <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,0.75)", fontSize: "0.85rem" }}>
            {competition.event_date
              ? new Date(competition.event_date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
              : "No date set"}
          </p>
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
            {competition.status}
          </span>
        </div>
        {isAdmin && (
          <button
            style={{
              width: "auto",
              flexShrink: 0,
              marginTop: 0,
              padding: "8px 14px",
              fontSize: "0.85rem",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.3)",
            }}
            onClick={() => onDelete(competition.id)}
          >
            Delete competition
          </button>
        )}
      </div>

      {competition.status === "setup" && (
        <SetupStage
          competition={competition}
          players={players}
          teams={teams}
          groups={groups}
          groupTeams={groupTeams}
          isAdmin={isAdmin}
          onChanged={refreshAfterChange}
        />
      )}

      {(competition.status === "groups" || competition.status === "knockout" || competition.status === "completed") && (
        <GroupStandingsSection
          groups={groups}
          groupTeams={groupTeams}
          matches={matches}
          teamLabel={teamLabel}
          advancePerGroup={competition.advance_per_group}
          scoringSystem={competition.scoring_system}
        />
      )}

      {competition.status === "groups" && (
        <GroupFixturesSection
          competition={competition}
          groups={groups}
          matches={matches}
          teamLabel={teamLabel}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onChanged={refreshAfterChange}
        />
      )}

      {(competition.status === "knockout" || competition.status === "completed") && (
        <KnockoutSection
          competition={competition}
          teams={teams}
          matches={matches}
          teamLabel={teamLabel}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onChanged={refreshAfterChange}
        />
      )}

      {competition.status === "completed" && (
        <CompletedSection
          competition={competition}
          teams={teams}
          matches={matches}
          teamLabel={teamLabel}
          isAdmin={isAdmin}
          onChanged={refreshAfterChange}
        />
      )}
    </div>
  );
}

// ── Setup: teams + groups ──────────────────────────────────────────────

function SetupStage({
  competition,
  players,
  teams,
  groups,
  groupTeams,
  isAdmin,
  onChanged,
}: {
  competition: CompetitionRow;
  players: PlayerStatus[];
  teams: CompetitionTeamRow[];
  groups: CompetitionGroupRow[];
  groupTeams: CompetitionGroupTeamRow[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [teamName, setTeamName] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const usedPlayerIds = new Set(teams.flatMap((t) => [t.player1_id, t.player2_id]));
  const groupIdByTeamId = new Map(groupTeams.map((gt) => [gt.team_id, gt.group_id]));

  async function addTeam() {
    if (!p1 || !p2 || p1 === p2) return;
    setSavingTeam(true);
    setTeamError(null);
    const { error } = await supabase.from("competition_teams").insert({
      competition_id: competition.id,
      player1_id: p1,
      player2_id: p2,
      team_name: teamName.trim() || null,
    });
    setSavingTeam(false);
    if (error) {
      setTeamError(error.message);
      return;
    }
    setP1("");
    setP2("");
    setTeamName("");
    onChanged();
  }

  async function deleteTeam(teamId: string) {
    if (!confirm("Remove this team? Only possible before they've played any games.")) return;
    const { error } = await supabase.from("competition_teams").delete().eq("id", teamId);
    if (error) {
      alert(`Couldn't remove team: ${error.message}`);
      return;
    }
    onChanged();
  }

  async function addGroup() {
    if (!newGroupName.trim()) return;
    setSavingGroup(true);
    const { error } = await supabase.from("competition_groups").insert({
      competition_id: competition.id,
      name: newGroupName.trim(),
      sort_order: groups.length,
    });
    setSavingGroup(false);
    if (error) {
      alert(`Couldn't add group: ${error.message}`);
      return;
    }
    setNewGroupName("");
    onChanged();
  }

  async function assignTeamToGroup(teamId: string, groupId: string) {
    const { error } = await supabase
      .from("competition_group_teams")
      .upsert({ team_id: teamId, group_id: groupId }, { onConflict: "team_id" });
    if (error) {
      alert(`Couldn't assign team: ${error.message}`);
      return;
    }
    onChanged();
  }

  async function unassignTeam(teamId: string) {
    const { error } = await supabase.from("competition_group_teams").delete().eq("team_id", teamId);
    if (error) {
      alert(`Couldn't unassign team: ${error.message}`);
      return;
    }
    onChanged();
  }

  async function startGroupStage() {
    setStartError(null);
    const unassigned = teams.filter((t) => !groupIdByTeamId.has(t.id));
    if (unassigned.length > 0) {
      setStartError(`Every team needs a group first — ${unassigned.length} team(s) not yet assigned.`);
      return;
    }
    const groupsWithTooFewTeams = groups.filter(
      (g) => groupTeams.filter((gt) => gt.group_id === g.id).length < 2
    );
    if (groupsWithTooFewTeams.length > 0) {
      setStartError(`Every group needs at least 2 teams — check ${groupsWithTooFewTeams.map((g) => g.name).join(", ")}.`);
      return;
    }
    if (!confirm("Start the group stage? This creates every group's fixture list — you can still add results as you go.")) {
      return;
    }
    setStarting(true);

    const fixtureRows = groups.flatMap((g) => {
      const teamIds = groupTeams.filter((gt) => gt.group_id === g.id).map((gt) => gt.team_id);
      return generateGroupFixtures(teamIds, competition.double_round_robin).map((f) => ({
        competition_id: competition.id,
        group_id: g.id,
        team_a_id: f.teamAId,
        team_b_id: f.teamBId,
        leg: f.leg,
      }));
    });

    const { error: fixtureError } = await supabase.from("competition_matches").insert(fixtureRows);
    if (fixtureError) {
      setStartError(fixtureError.message);
      setStarting(false);
      return;
    }

    const { error: statusError } = await supabase
      .from("competitions")
      .update({ status: "groups" })
      .eq("id", competition.id);
    setStarting(false);
    if (statusError) {
      setStartError(statusError.message);
      return;
    }
    onChanged();
  }

  if (!isAdmin) {
    return <p className="stat-meta">This competition is still being set up by an admin.</p>;
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Teams ({teams.length})</h3>
        <label style={{ marginTop: 0 }}>Player 1</label>
        <PlayerSelect
          label=""
          players={players}
          value={p1}
          onChange={setP1}
          disabledIds={[...usedPlayerIds, p2].filter(Boolean)}
        />
        <label>Player 2</label>
        <PlayerSelect
          label=""
          players={players}
          value={p2}
          onChange={setP2}
          disabledIds={[...usedPlayerIds, p1].filter(Boolean)}
        />
        <label>Team name (optional)</label>
        <input
          type="text"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="Defaults to both names"
        />
        {teamError && <p className="error">{teamError}</p>}
        <button disabled={savingTeam || !p1 || !p2 || p1 === p2} onClick={addTeam} style={{ marginTop: 12 }}>
          {savingTeam ? "Adding…" : "Add team"}
        </button>

        {teams.length > 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {teams.map((t) => (
              <div key={t.id} className="match-row">
                <div className="opponent">
                  {t.team_name || `${nameById(players, t.player1_id)} & ${nameById(players, t.player2_id)}`}
                </div>
                <span className="link-action" role="button" tabIndex={0} onClick={() => deleteTeam(t.id)}>
                  Remove
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Groups ({groups.length})</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g. Group A"
            style={{ flex: 1 }}
          />
          <button
            disabled={savingGroup || !newGroupName.trim()}
            onClick={addGroup}
            style={{ width: "auto", marginTop: 0 }}
          >
            Add group
          </button>
        </div>

        {groups.map((g) => {
          const teamsInGroup = groupTeams.filter((gt) => gt.group_id === g.id).map((gt) => gt.team_id);
          const unassignedTeams = teams.filter((t) => !groupIdByTeamId.has(t.id));
          return (
            <div key={g.id} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <strong>{g.name}</strong>
              {teamsInGroup.length === 0 && <p className="stat-meta">No teams yet.</p>}
              {teamsInGroup.map((teamId) => {
                const t = teams.find((x) => x.id === teamId);
                if (!t) return null;
                return (
                  <div key={teamId} className="match-row">
                    <div className="opponent">
                      {t.team_name || `${nameById(players, t.player1_id)} & ${nameById(players, t.player2_id)}`}
                    </div>
                    <span className="link-action" role="button" tabIndex={0} onClick={() => unassignTeam(teamId)}>
                      Unassign
                    </span>
                  </div>
                );
              })}
              {unassignedTeams.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && assignTeamToGroup(e.target.value, g.id)}
                  style={{ marginTop: 8 }}
                >
                  <option value="">+ Add team to this group…</option>
                  {unassignedTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.team_name || `${nameById(players, t.player1_id)} & ${nameById(players, t.player2_id)}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {startError && <p className="error">{startError}</p>}
      <button disabled={starting || teams.length === 0 || groups.length === 0} onClick={startGroupStage}>
        {starting ? "Starting…" : "Start group stage"}
      </button>
    </div>
  );
}

function nameById(players: PlayerStatus[], id: string): string {
  return players.find((p) => p.id === id)?.display_name ?? "?";
}

// ── Group standings (shown during groups, knockout, and completed) ─────

function GroupStandingsSection({
  groups,
  groupTeams,
  matches,
  teamLabel,
  advancePerGroup,
  scoringSystem,
}: {
  groups: CompetitionGroupRow[];
  groupTeams: CompetitionGroupTeamRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  advancePerGroup: number;
  scoringSystem: ScoringSystem;
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Group standings</h3>
      {scoringSystem === "social" && (
        <p className="stat-meta" style={{ marginTop: -4 }}>
          Social scoring: 2 points for a win, plus 1 point for the losing team if they scored more than 6.
        </p>
      )}
      {groups.map((g) => {
        const teamIds = groupTeams.filter((gt) => gt.group_id === g.id).map((gt) => gt.team_id);
        const played = matches
          .filter((m) => m.group_id === g.id && m.matches)
          .map((m) => ({
            teamAId: m.team_a_id,
            teamBId: m.team_b_id,
            teamAScore: m.matches!.team_a_score,
            teamBScore: m.matches!.team_b_score,
          }));
        const standings = computeGroupStandings(teamIds, played, scoringSystem);
        return (
          <div key={g.id} style={{ marginBottom: 20 }}>
            <strong>{g.name}</strong>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                    <th style={{ padding: "4px 6px" }}>Team</th>
                    <th style={{ padding: "4px 6px", textAlign: "center" }}>P</th>
                    <th style={{ padding: "4px 6px", textAlign: "center" }}>W</th>
                    <th style={{ padding: "4px 6px", textAlign: "center" }}>L</th>
                    <th style={{ padding: "4px 6px", textAlign: "center" }}>Diff</th>
                    <th style={{ padding: "4px 6px", textAlign: "center" }}>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, i) => (
                    <tr
                      key={row.teamId}
                      style={{
                        borderTop: "1px solid var(--border)",
                        fontWeight: i < advancePerGroup ? 700 : 400,
                        color: i < advancePerGroup ? "var(--navy-700)" : undefined,
                      }}
                    >
                      <td style={{ padding: "4px 6px" }}>{teamLabel(row.teamId)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>{row.played}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>{row.won}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>{row.lost}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                        {row.diff > 0 ? `+${row.diff}` : row.diff}
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>{row.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="stat-meta" style={{ marginTop: 0 }}>
        Top {advancePerGroup} in each group (bold) advance to the knockout stage.
      </p>
    </div>
  );
}

// ── Group fixtures / results entry ──────────────────────────────────────

function GroupFixturesSection({
  competition,
  groups,
  matches,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
}: {
  competition: CompetitionRow;
  groups: CompetitionGroupRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  // Which group's fixtures are shown at once. With several groups of up
  // to 8 teams each (a full "World Cup" style setup), stacking every
  // group's fixture list on one page made this card enormous — added
  // 2026-08-27 at Ben's request so only one group's games show at a time.
  // Only relevant once there's more than one group; a single-group
  // competition just shows everything, same as before.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const activeGroupId =
    selectedGroupId && groups.some((g) => g.id === selectedGroupId) ? selectedGroupId : groups[0]?.id ?? null;
  const groupsToShow = groups.length > 1 ? groups.filter((g) => g.id === activeGroupId) : groups;

  async function advanceToKnockout() {
    const unplayed = matches.filter((m) => m.group_id && !m.matches).length;
    const proceed = confirm(
      unplayed > 0
        ? `${unplayed} group game(s) haven't been played yet. Move to the knockout stage anyway?`
        : "Move to the knockout stage?"
    );
    if (!proceed) return;
    setAdvancing(true);
    const { error } = await supabase.from("competitions").update({ status: "knockout" }).eq("id", competition.id);
    setAdvancing(false);
    if (error) {
      alert(`Couldn't advance: ${error.message}`);
      return;
    }
    onChanged();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Group games</h3>
      {groups.length > 1 && (
        <>
          <label style={{ marginTop: 0 }}>Group</label>
          <select value={activeGroupId ?? ""} onChange={(e) => setSelectedGroupId(e.target.value)}>
            {groups.map((g) => {
              const groupMatches = matches.filter((m) => m.group_id === g.id);
              const unplayed = groupMatches.filter((m) => !m.matches).length;
              return (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {unplayed > 0 ? ` (${unplayed} unplayed)` : " (all played)"}
                </option>
              );
            })}
          </select>
        </>
      )}
      {groupsToShow.map((g) => (
        <div key={g.id} style={{ marginBottom: 16, marginTop: groups.length > 1 ? 16 : 0 }}>
          <strong>{g.name}</strong>
          {matches
            .filter((m) => m.group_id === g.id)
            .map((m) => (
              <FixtureRow
                key={m.id}
                match={m}
                teamLabel={teamLabel}
                isAdmin={isAdmin}
                currentUserId={currentUserId}
                onChanged={onChanged}
                locked={competition.status === "completed"}
              />
            ))}
        </div>
      ))}
      {isAdmin && (
        <button
          disabled={advancing}
          onClick={advanceToKnockout}
          style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
        >
          {advancing ? "Advancing…" : "Advance to knockout stage"}
        </button>
      )}
    </div>
  );
}

// Same sessionStorage-backed protection as Quick Entry's slots (see
// MatchEntry.tsx) — typing a score into a fixture on a long "Group games"
// page, then switching apps/tabs before hitting Save, was losing that
// typing on reload. Keyed per fixture (not one shared key) since many
// fixtures can each have their own in-progress score at once. Only used
// for NOT-yet-played fixtures — an already-played score being corrected
// via "Edit" is a much shorter-lived flow, not worth the extra
// persistence. Added 2026-08-27.
const FIXTURE_DRAFT_PREFIX = "sideline-draft-fixture-";

function loadFixtureScoreDraft(matchId: string): { scoreA: string; scoreB: string } {
  try {
    const raw = sessionStorage.getItem(FIXTURE_DRAFT_PREFIX + matchId);
    if (raw) return JSON.parse(raw) as { scoreA: string; scoreB: string };
  } catch {
    // malformed or unavailable storage — fall through to a blank draft
  }
  return { scoreA: "", scoreB: "" };
}

function clearFixtureScoreDraft(matchId: string) {
  try {
    sessionStorage.removeItem(FIXTURE_DRAFT_PREFIX + matchId);
  } catch {
    // ignore
  }
}

function FixtureRow({
  match,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
  locked,
}: {
  match: CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null };
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
  locked: boolean;
}) {
  const played = !!match.matches;
  const [scoreA, setScoreA] = useState(() => (played ? "" : loadFixtureScoreDraft(match.id).scoreA));
  const [scoreB, setScoreB] = useState(() => (played ? "" : loadFixtureScoreDraft(match.id).scoreB));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Mirrors the not-yet-submitted score to sessionStorage on every change.
  useEffect(() => {
    if (played) return; // only draft new entries, not in-progress edits of a played score
    if (scoreA === "" && scoreB === "") {
      clearFixtureScoreDraft(match.id);
      return;
    }
    try {
      sessionStorage.setItem(FIXTURE_DRAFT_PREFIX + match.id, JSON.stringify({ scoreA, scoreB }));
    } catch {
      // storage full/unavailable — not worth surfacing an error for a convenience feature
    }
  }, [scoreA, scoreB, match.id, played]);

  function startEdit() {
    setScoreA(String(match.matches!.team_a_score));
    setScoreB(String(match.matches!.team_b_score));
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  // Corrects an already-saved score before the competition wraps up. Reuses
  // the same edit-match edge function as Game History's "Edit score" (see
  // GameHistory.tsx) — it replays the whole confirmed match history from
  // the corrected score onward, so ratings stay correct for everyone, not
  // just these four players. Added 2026-08-26 after Ben mis-saved a score
  // during testing and had no way to fix it.
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
    if (
      !confirm(
        `Change the score to ${teamAScore}–${teamBScore}? Ratings get recalculated from the corrected match history afterward.`
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const { error: editError } = await supabase.functions.invoke("edit-match", {
      body: { match_id: match.match_id, team_a_score: teamAScore, team_b_score: teamBScore },
    });

    if (editError) {
      // Same reasoning as GameHistory's saveEdit: a confirmed match's edit
      // triggers a full recompute that can outlast the client's request
      // timeout even though it finishes successfully — recheck the real
      // saved score before treating this as a genuine failure.
      const { data: recheck } = await supabase
        .from("matches")
        .select("team_a_score, team_b_score")
        .eq("id", match.match_id)
        .single();
      if (!(recheck?.team_a_score === teamAScore && recheck?.team_b_score === teamBScore)) {
        setSubmitting(false);
        setError(editError.message);
        return;
      }
    }

    // The score change may have flipped the winner — keep the bracket/
    // standings' winner_team_id in sync with the corrected score.
    const winnerTeamId = teamAScore > teamBScore ? match.team_a_id : match.team_b_id;
    const { error: linkError } = await supabase
      .from("competition_matches")
      .update({ winner_team_id: winnerTeamId })
      .eq("id", match.id);

    setSubmitting(false);
    if (linkError) {
      setError(linkError.message);
      return;
    }
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

    const team = (
      await supabase
        .from("competition_teams")
        .select("id, player1_id, player2_id")
        .in("id", [match.team_a_id, match.team_b_id])
    ).data;
    const teamA = team?.find((t) => t.id === match.team_a_id);
    const teamB = team?.find((t) => t.id === match.team_b_id);
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
    // recent confirmed match between exactly these 4 players rather than
    // threading it back through submitOneMatch's return value, to avoid
    // changing that shared helper's shape for every other caller.
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
      .from("competition_matches")
      .update({ match_id: recentMatch?.id ?? null, winner_team_id: winnerTeamId })
      .eq("id", match.id);

    setSubmitting(false);
    if (linkError) {
      setError(linkError.message);
      return;
    }
    clearFixtureScoreDraft(match.id);
    onChanged();
  }

  return (
    <div className="match-row" style={{ flexWrap: "wrap" }}>
      <div className="opponent" style={{ flex: "1 1 100%" }}>
        {teamLabel(match.team_a_id)} vs {teamLabel(match.team_b_id)}
        {match.group_id && match.leg === 2 && (
          <span className="stat-meta" style={{ display: "block", marginTop: 2, fontWeight: 400 }}>
            2nd meeting
          </span>
        )}
      </div>
      {played && !editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="score">
            {match.matches!.team_a_score}–{match.matches!.team_b_score}
          </div>
          {isAdmin && !locked && (
            <span className="link-action" style={{ fontSize: "0.8rem" }} onClick={startEdit}>
              Edit
            </span>
          )}
        </div>
      ) : (played && editing) || (!played && isAdmin) ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            min={0}
            value={scoreA}
            onChange={(e) => setScoreA(e.target.value)}
            style={{ width: 56, padding: "6px 8px" }}
          />
          <span>–</span>
          <input
            type="number"
            min={0}
            value={scoreB}
            onChange={(e) => setScoreB(e.target.value)}
            style={{ width: 56, padding: "6px 8px" }}
          />
          <button
            disabled={submitting}
            onClick={played ? saveEdit : submit}
            style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: "0.8rem" }}
          >
            {submitting ? "…" : "Save"}
          </button>
          {played && (
            <span
              className="link-action"
              style={{ fontSize: "0.8rem", opacity: submitting ? 0.5 : 1, pointerEvents: submitting ? "none" : "auto" }}
              onClick={cancelEdit}
            >
              Cancel
            </span>
          )}
        </div>
      ) : (
        <div className="score">—</div>
      )}
      {error && <p className="error" style={{ width: "100%" }}>{error}</p>}
    </div>
  );
}

// ── Knockout bracket ─────────────────────────────────────────────────────

function KnockoutSection({
  competition,
  teams,
  matches,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
}: {
  competition: CompetitionRow;
  teams: CompetitionTeamRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [round, setRound] = useState<KnockoutRound>("quarterfinal");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const knockoutMatches = matches.filter((m) => m.knockout_round);

  async function addMatch() {
    if (!teamA || !teamB || teamA === teamB) return;
    setAdding(true);
    setAddError(null);
    const slot = knockoutMatches.filter((m) => m.knockout_round === round).length;
    const { error } = await supabase.from("competition_matches").insert({
      competition_id: competition.id,
      knockout_round: round,
      knockout_slot: slot,
      team_a_id: teamA,
      team_b_id: teamB,
    });
    setAdding(false);
    if (error) {
      setAddError(error.message);
      return;
    }
    setTeamA("");
    setTeamB("");
    onChanged();
  }

  async function completeCompetition() {
    const final = knockoutMatches.find((m) => m.knockout_round === "final" && m.winner_team_id);
    if (!final) {
      setCompleteError("The final needs a result before the competition can be marked complete.");
      return;
    }
    if (!confirm("Mark this competition complete and record final placements? This shows on the Club Stats page.")) {
      return;
    }
    setCompleting(true);
    setCompleteError(null);

    const gold = final.winner_team_id!;
    const silver = final.team_a_id === gold ? final.team_b_id : final.team_a_id;

    const thirdPlace = knockoutMatches.find((m) => m.knockout_round === "third_place" && m.winner_team_id);
    const results: { competition_id: string; team_id: string; placement: number }[] = [
      { competition_id: competition.id, team_id: gold, placement: 1 },
      { competition_id: competition.id, team_id: silver, placement: 2 },
    ];

    if (thirdPlace) {
      const bronze = thirdPlace.winner_team_id!;
      const fourth = thirdPlace.team_a_id === bronze ? thirdPlace.team_b_id : thirdPlace.team_a_id;
      results.push({ competition_id: competition.id, team_id: bronze, placement: 3 });
      results.push({ competition_id: competition.id, team_id: fourth, placement: 4 });
    } else {
      // No 3rd-place playoff — both semifinal losers share bronze.
      const semis = knockoutMatches.filter((m) => m.knockout_round === "semifinal" && m.winner_team_id);
      for (const s of semis) {
        const loser = s.team_a_id === s.winner_team_id ? s.team_b_id : s.team_a_id;
        results.push({ competition_id: competition.id, team_id: loser, placement: 3 });
      }
    }

    const { error: resultsError } = await supabase.from("competition_results").insert(results);
    if (resultsError) {
      setCompleteError(resultsError.message);
      setCompleting(false);
      return;
    }

    const { error: statusError } = await supabase
      .from("competitions")
      .update({ status: "completed" })
      .eq("id", competition.id);
    setCompleting(false);
    if (statusError) {
      setCompleteError(statusError.message);
      return;
    }
    onChanged();
  }

  return (
    <div className="card card-knockout">
      <h3 style={{ marginTop: 0 }}>🏆 Knockout bracket</h3>

      {KNOCKOUT_ROUNDS.map(({ value, label }) => {
        const roundMatches = knockoutMatches
          .filter((m) => m.knockout_round === value)
          .sort((a, b) => (a.knockout_slot ?? 0) - (b.knockout_slot ?? 0));
        if (roundMatches.length === 0) return null;
        // Final/semifinal headings get a bit more visual weight than the
        // earlier rounds (2026-08-28, Ben: "should feel a bit more special
        // and standout a touch") — everything from quarterfinal down stays
        // as plain bold text.
        const isFinal = value === "final";
        const isSemifinal = value === "semifinal";
        return (
          <div key={value} style={{ marginBottom: 16 }}>
            <div
              style={
                isFinal
                  ? { fontWeight: 800, fontSize: "1.15rem", color: "var(--orange-600)", letterSpacing: "0.02em", marginBottom: 4 }
                  : isSemifinal
                  ? { fontWeight: 700, fontSize: "1rem", color: "var(--navy-500)", marginBottom: 4 }
                  : { fontWeight: 700, color: "var(--navy-700)", marginBottom: 4 }
              }
            >
              {isFinal ? "🏆 " : isSemifinal ? "🥈 " : ""}
              {label}
            </div>
            {roundMatches.map((m) => (
              <FixtureRow
                key={m.id}
                match={m}
                teamLabel={teamLabel}
                isAdmin={isAdmin}
                currentUserId={currentUserId}
                onChanged={onChanged}
                locked={competition.status === "completed"}
              />
            ))}
          </div>
        );
      })}

      {isAdmin && competition.status === "knockout" && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <strong>Add a knockout match</strong>
          <label style={{ marginTop: 8 }}>Round</label>
          <select value={round} onChange={(e) => setRound(e.target.value as KnockoutRound)}>
            {KNOCKOUT_ROUNDS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <label>Team A</label>
          <select value={teamA} onChange={(e) => setTeamA(e.target.value)}>
            <option value="">Select team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id} disabled={t.id === teamB}>
                {teamLabel(t.id)}
              </option>
            ))}
          </select>
          <label>Team B</label>
          <select value={teamB} onChange={(e) => setTeamB(e.target.value)}>
            <option value="">Select team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id} disabled={t.id === teamA}>
                {teamLabel(t.id)}
              </option>
            ))}
          </select>
          {addError && <p className="error">{addError}</p>}
          <button disabled={adding || !teamA || !teamB || teamA === teamB} onClick={addMatch} style={{ marginTop: 12 }}>
            {adding ? "Adding…" : "Add match"}
          </button>
        </div>
      )}

      {isAdmin && competition.status === "knockout" && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          {completeError && <p className="error">{completeError}</p>}
          {/* Blue stroke (2026-08-28, Ben's request) — this is the one
              button on the page with a real, hard-to-undo-casually
              consequence (locks the bracket, writes final placements to
              Club Stats), so it should read as visually distinct from the
              routine "Add match" button above rather than blending in. */}
          <button
            disabled={completing}
            onClick={completeCompetition}
            style={{ border: "2px solid var(--sky-600)" }}
          >
            {completing ? "Finishing…" : "Mark competition complete"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Completed: final placements ──────────────────────────────────────────

// Competition Summary (2026-08-28, Ben's request) — extends the original
// bare "Final placements" list into a fuller recap: the podium called out
// more prominently, plus a couple of fun, positive-only stats pulled from
// the competition's own matches (highest scoring team, biggest win).
// Deliberately excludes anything framed around a loss/worst performance
// (no "biggest defeat", no "fewest wins") per Ben's explicit ask — every
// stat here should be something a team is happy to see themselves in.
function CompletedSection({
  competition,
  teams,
  matches,
  teamLabel,
  isAdmin,
  onChanged,
}: {
  competition: CompetitionRow;
  teams: CompetitionTeamRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [results, setResults] = useState<{ placement: number; team_id: string }[]>([]);
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    supabase
      .from("competition_results")
      .select("placement, team_id")
      .eq("competition_id", competition.id)
      .order("placement")
      .then(({ data }) => setResults(data ?? []));
  }, [competition.id]);

  const podium = results.filter((r) => r.placement <= 3);

  // Highest scoring team — total points scored across every played match
  // (group + knockout) in the competition.
  const scoreByTeam = new Map<string, number>();
  for (const m of matches) {
    if (!m.matches) continue;
    scoreByTeam.set(m.team_a_id, (scoreByTeam.get(m.team_a_id) ?? 0) + m.matches.team_a_score);
    scoreByTeam.set(m.team_b_id, (scoreByTeam.get(m.team_b_id) ?? 0) + m.matches.team_b_score);
  }
  let topScorer: { teamId: string; points: number } | null = null;
  for (const [teamId, points] of scoreByTeam) {
    if (!topScorer || points > topScorer.points) topScorer = { teamId, points };
  }

  // Biggest win — largest margin of victory in any single played match.
  let biggestWin: { winnerId: string; loserId: string; winnerScore: number; loserScore: number; margin: number } | null = null;
  for (const m of matches) {
    if (!m.matches || !m.winner_team_id) continue;
    const winnerIsA = m.winner_team_id === m.team_a_id;
    const winnerScore = winnerIsA ? m.matches.team_a_score : m.matches.team_b_score;
    const loserScore = winnerIsA ? m.matches.team_b_score : m.matches.team_a_score;
    const margin = winnerScore - loserScore;
    if (margin > 0 && (!biggestWin || margin > biggestWin.margin)) {
      biggestWin = {
        winnerId: m.winner_team_id,
        loserId: winnerIsA ? m.team_b_id : m.team_a_id,
        winnerScore,
        loserScore,
        margin,
      };
    }
  }

  async function reopenCompetition() {
    if (
      !confirm(
        "Reopen this competition? It'll move back to the knockout stage so results can be corrected — the recorded final placements will be cleared until you mark it complete again."
      )
    ) {
      return;
    }
    setReopening(true);
    await supabase.from("competition_results").delete().eq("competition_id", competition.id);
    const { error } = await supabase.from("competitions").update({ status: "knockout" }).eq("id", competition.id);
    setReopening(false);
    if (!error) onChanged();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🏁 Competition summary</h3>

      {podium.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {podium.map((r) => (
            <div
              key={`${r.placement}-${r.team_id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 10,
                // Blue rather than orange (2026-08-29, Ben's request) — the
                // Knockout bracket card above already uses orange, so the
                // winner here gets its own colour to stay visually distinct
                // from it rather than blending together.
                background: r.placement === 1 ? "rgba(43, 120, 209, 0.14)" : "var(--bg-subtle, rgba(15,37,71,0.04))",
                border: r.placement === 1 ? "1.5px solid var(--sky-600)" : "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: "1.3rem" }}>{MEDALS[r.placement] ?? `${r.placement}th`}</span>
              <span style={{ fontWeight: r.placement === 1 ? 800 : 600 }}>{teamLabel(r.team_id)}</span>
            </div>
          ))}
        </div>
      )}

      {(topScorer || biggestWin) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          {topScorer && (
            <div style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))", border: "1px solid var(--border)" }}>
              <div className="stat-meta" style={{ margin: 0 }}>🔥 Highest scoring team</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{teamLabel(topScorer.teamId)}</div>
              <div className="stat-meta" style={{ marginTop: 2 }}>{topScorer.points} points across the competition</div>
            </div>
          )}
          {biggestWin && (
            <div style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))", border: "1px solid var(--border)" }}>
              <div className="stat-meta" style={{ margin: 0 }}>💥 Biggest win</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{teamLabel(biggestWin.winnerId)}</div>
              <div className="stat-meta" style={{ marginTop: 2 }}>
                Beat {teamLabel(biggestWin.loserId)} {biggestWin.winnerScore}–{biggestWin.loserScore}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="stat-meta" style={{ marginTop: 12 }}>
        This also appears in the "Past competitions" section on Club Stats.
      </p>

      {isAdmin && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <button
            disabled={reopening}
            onClick={reopenCompetition}
            style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
          >
            {reopening ? "Reopening…" : "Reopen competition (marked complete by mistake?)"}
          </button>
        </div>
      )}
    </div>
  );
}
