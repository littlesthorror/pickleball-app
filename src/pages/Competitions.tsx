import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { PlayerSelect, submitOneMatch } from "./MatchEntry";
import { computeGroupStandings, generateGroupFixtures } from "../lib/competitionStandings";
import type {
  CompetitionRow,
  CompetitionTeamRow,
  CompetitionGroupRow,
  CompetitionGroupTeamRow,
  CompetitionMatchRow,
  KnockoutRound,
  PlayerStatus,
} from "../types";

const KNOCKOUT_ROUNDS: { value: KnockoutRound; label: string }[] = [
  { value: "quarterfinal", label: "Quarterfinal" },
  { value: "semifinal", label: "Semifinal" },
  { value: "third_place", label: "3rd place playoff" },
  { value: "final", label: "Final" },
];

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

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
  const [creating, setCreating] = useState(false);

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
    await loadCompetitions();
    setSelectedId(data.id);
  }

  const selected = competitions.find((c) => c.id === selectedId) ?? null;

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
          <h2 style={{ marginTop: 0 }}>New competition</h2>
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
          <button disabled={creating || !newName.trim()} onClick={handleCreate} style={{ marginTop: 16 }}>
            {creating ? "Creating…" : "Create competition"}
          </button>
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
}: {
  competition: CompetitionRow;
  players: PlayerStatus[];
  isAdmin: boolean;
  currentUserId: string;
  onCompetitionChanged: () => void;
}) {
  const [teams, setTeams] = useState<CompetitionTeamRow[]>([]);
  const [groups, setGroups] = useState<CompetitionGroupRow[]>([]);
  const [groupTeams, setGroupTeams] = useState<CompetitionGroupTeamRow[]>([]);
  const [matches, setMatches] = useState<(CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
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
    });
  }

  useEffect(() => {
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
      <h2 style={{ marginBottom: 4 }}>{competition.name}</h2>
      <p className="stat-meta" style={{ marginTop: 0 }}>
        {competition.event_date
          ? new Date(competition.event_date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
          : "No date set"}{" "}
        · Status: <strong>{competition.status}</strong>
      </p>

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
        <CompletedSection competitionId={competition.id} teamLabel={teamLabel} />
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
      return generateGroupFixtures(teamIds).map((f) => ({
        competition_id: competition.id,
        group_id: g.id,
        team_a_id: f.teamAId,
        team_b_id: f.teamBId,
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
}: {
  groups: CompetitionGroupRow[];
  groupTeams: CompetitionGroupTeamRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  advancePerGroup: number;
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Group standings</h3>
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
        const standings = computeGroupStandings(teamIds, played);
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
      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 16 }}>
          <strong>{g.name}</strong>
          {matches
            .filter((m) => m.group_id === g.id)
            .map((m) => (
              <FixtureRow key={m.id} match={m} teamLabel={teamLabel} isAdmin={isAdmin} currentUserId={currentUserId} onChanged={onChanged} />
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

function FixtureRow({
  match,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
}: {
  match: CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null };
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const played = !!match.matches;

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
    onChanged();
  }

  return (
    <div className="match-row" style={{ flexWrap: "wrap" }}>
      <div className="opponent">
        {teamLabel(match.team_a_id)} vs {teamLabel(match.team_b_id)}
      </div>
      {played ? (
        <div className="score">
          {match.matches!.team_a_score}–{match.matches!.team_b_score}
        </div>
      ) : isAdmin ? (
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
          <button disabled={submitting} onClick={submit} style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: "0.8rem" }}>
            {submitting ? "…" : "Save"}
          </button>
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
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Knockout bracket</h3>

      {KNOCKOUT_ROUNDS.map(({ value, label }) => {
        const roundMatches = knockoutMatches
          .filter((m) => m.knockout_round === value)
          .sort((a, b) => (a.knockout_slot ?? 0) - (b.knockout_slot ?? 0));
        if (roundMatches.length === 0) return null;
        return (
          <div key={value} style={{ marginBottom: 16 }}>
            <strong>{label}</strong>
            {roundMatches.map((m) => (
              <FixtureRow key={m.id} match={m} teamLabel={teamLabel} isAdmin={isAdmin} currentUserId={currentUserId} onChanged={onChanged} />
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
          <button disabled={completing} onClick={completeCompetition}>
            {completing ? "Finishing…" : "Mark competition complete"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Completed: final placements ──────────────────────────────────────────

function CompletedSection({ competitionId, teamLabel }: { competitionId: string; teamLabel: (id: string) => string }) {
  const [results, setResults] = useState<{ placement: number; team_id: string }[]>([]);

  useEffect(() => {
    supabase
      .from("competition_results")
      .select("placement, team_id")
      .eq("competition_id", competitionId)
      .order("placement")
      .then(({ data }) => setResults(data ?? []));
  }, [competitionId]);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Final placements</h3>
      {results.map((r) => (
        <div className="match-row" key={`${r.placement}-${r.team_id}`}>
          <div className="opponent">
            {MEDALS[r.placement] ?? `${r.placement}th`} {teamLabel(r.team_id)}
          </div>
        </div>
      ))}
      <p className="stat-meta" style={{ marginTop: 12 }}>
        This also appears in the "Past competitions" section on Club Stats.
      </p>
    </div>
  );
}
