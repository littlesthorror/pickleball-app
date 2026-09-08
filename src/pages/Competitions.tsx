import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { PlayerSelect, submitOneMatch } from "./MatchEntry";
import { computeGroupStandings, generateGroupFixtures, scheduleFixturesByCourt } from "../lib/competitionStandings";
import { buildFixturesDocxBlob, downloadBlob } from "../lib/fixturesDocx";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import PageLoading from "../components/PageLoading";
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
  const confirm = useConfirm();
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
  // Advanced settings sub-section (2026-09-07, Ben's request) — currently
  // just houses "teams advancing per group", but nested separately from the
  // main form fields so it has room to grow without cluttering the common
  // path. Always starts collapsed — this is the exception case, not
  // something every admin needs to touch on every competition.
  const [showAdvanced, setShowAdvanced] = useState(false);

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
          // Defaults to the newest ACTIVE (not-yet-completed) competition
          // rather than just the newest overall (2026-09-07, Ben's request,
          // alongside the archive below) — otherwise a club running lots of
          // competitions would land on a wrapped-up one by default just
          // because it happened to be created most recently.
          setSelectedId((prev) => prev ?? rows.find((c) => c.status !== "completed")?.id ?? null);
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
    // Type-to-confirm (2026-09-07, Ben's request: "have to type the word
    // DELETE. For safety") — this is the one truly irreversible action on
    // this page (no undo, cascades to teams/groups/bracket/results), so it
    // gets the extra speed bump on top of the usual danger-styled confirm.
    if (
      !(await confirm(`Delete "${target.name}"? This removes its teams, groups, and bracket — permanently.`, {
        danger: true,
        requireTypedConfirmation: "DELETE",
      }))
    )
      return;
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

  // Completed competitions move into a collapsed archive below (2026-09-07,
  // Ben's request — "we plan to run a lot of comps and looking at how to
  // manage this effectively"). Active ones keep behaving exactly as
  // before, via the "Viewing" selector.
  const activeCompetitions = competitions.filter((c) => c.status !== "completed");
  const archivedCompetitions = competitions.filter((c) => c.status === "completed");

  // Winner name per archived competition, for the collapsed row's subtitle
  // — fetched once for the whole archive rather than per-row, since it's
  // just placement-1 results plus the teams they belong to. Doesn't block
  // rendering the rows themselves; a row's winner line just fills in once
  // this resolves.
  const [archiveWinners, setArchiveWinners] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (archivedCompetitions.length === 0) {
      setArchiveWinners(new Map());
      return;
    }
    const ids = archivedCompetitions.map((c) => c.id);
    Promise.all([
      supabase.from("competition_results").select("competition_id, team_id").in("competition_id", ids).eq("placement", 1),
      supabase.from("competition_teams").select("id, team_name, player1_id, player2_id").in("competition_id", ids),
    ]).then(([resultsRes, teamsRes]) => {
      const teamById = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
      const nameById = new Map(players.map((p) => [p.id, p.display_name]));
      const map = new Map<string, string>();
      for (const r of resultsRes.data ?? []) {
        const t = teamById.get(r.team_id);
        if (!t) continue;
        map.set(
          r.competition_id,
          t.team_name || `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`
        );
      }
      setArchiveWinners(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitions, players]);

  if (loading) return <PageLoading label="Loading competitions…" />;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Competitions</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Fixed-team doubles competitions — group stage, then a knockout bracket. Results here count toward
        everyone's normal club rating too.
      </p>

      {activeCompetitions.length > 1 && (
        <div className="card">
          <label style={{ marginTop: 0 }}>Viewing</label>
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {activeCompetitions.map((c) => (
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

              {/* Advanced settings (2026-09-07, Ben's request) — nested,
                  separately-collapsible sub-section so it has room to grow
                  without cluttering the common "just create a competition"
                  path. Collapsed by default every time (unlike the outer
                  form, which opens itself when there's nothing else on the
                  page yet) since this is the exception case. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  marginTop: 20,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <strong style={{ fontSize: "0.9rem" }}>Advanced settings</strong>
                <span style={{ color: "var(--navy-500)", fontWeight: 700, fontSize: "0.85rem" }}>
                  {showAdvanced ? "Hide ▲" : "Show ▼"}
                </span>
              </div>
              {showAdvanced && (
                <>
                  <label>Auto-qualify from groups</label>
                  <select value={newAdvance} onChange={(e) => setNewAdvance(e.target.value)}>
                    <option value="2">Top 2 per group</option>
                    <option value="4">Top 4 per group</option>
                  </select>
                  <p className="stat-meta" style={{ marginTop: 4 }}>
                    When you move to the knockout stage, only these top finishers from each group will show up as
                    selectable teams — no more scrolling past teams that didn't qualify.
                  </p>
                </>
              )}

              <button disabled={creating || !newName.trim()} onClick={handleCreate} style={{ marginTop: 16 }}>
                {creating ? "Creating…" : "Create competition"}
              </button>
            </>
          )}
        </div>
      )}

      {!selected && archivedCompetitions.length === 0 && (
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

      {archivedCompetitions.length > 0 && (
        <div style={{ marginTop: selected ? 24 : 0 }}>
          <h2 style={{ marginBottom: 4 }}>Competition archive</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Completed competitions, collapsed to keep this page manageable — tap one to see its full standings
            and bracket.
          </p>
          {archivedCompetitions.map((c) => (
            <CompetitionArchiveRow
              key={c.id}
              competition={c}
              winnerLabel={archiveWinners.get(c.id) ?? null}
              players={players}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onCompetitionChanged={loadCompetitions}
              onDelete={handleDeleteCompetition}
              bannerIndex={
                (competitions.length - 1 - competitions.findIndex((x) => x.id === c.id)) % COMPETITION_BANNERS.length
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// A completed competition, collapsed to just its name/date/winner with a
// tap-to-expand toggle (2026-09-07, Ben's request — running lots of
// competitions was turning this page into an ever-growing scroll of full
// banners/brackets for comps nobody needed to look at again). Expanding
// mounts the exact same CompetitionDetail used for the active "Viewing"
// competition above, so editing/deleting/reopening a past competition
// still works identically — this is purely a display wrapper.
function CompetitionArchiveRow({
  competition,
  winnerLabel,
  players,
  isAdmin,
  currentUserId,
  onCompetitionChanged,
  onDelete,
  bannerIndex,
}: {
  competition: CompetitionRow;
  winnerLabel: string | null;
  players: PlayerStatus[];
  isAdmin: boolean;
  currentUserId: string;
  onCompetitionChanged: () => void;
  onDelete: (id: string) => void;
  bannerIndex: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    // Gold stroke (2026-09-07, Ben's request) — visually marks these as
    // "done and settled" trophies rather than just another card, matching
    // the gold used for the frame-tier/podium colouring elsewhere
    // (--gold-600 in index.css).
    <div className="card" style={{ marginTop: 10, border: "1px solid var(--gold-600)" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer" }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>🏆 {competition.name}</div>
          <div className="stat-meta" style={{ marginTop: 2 }}>
            {competition.event_date
              ? new Date(competition.event_date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
              : "No date set"}
            {winnerLabel && <> · Winner: {winnerLabel}</>}
          </div>
        </div>
        <span style={{ color: "var(--navy-500)", fontWeight: 700, flexShrink: 0 }}>
          {expanded ? "Hide ▲" : "Show ▼"}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: 16 }}>
          <CompetitionDetail
            competition={competition}
            players={players}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onCompetitionChanged={onCompetitionChanged}
            onDelete={onDelete}
            bannerIndex={bannerIndex}
          />
        </div>
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
  const toast = useToast();
  // Inline title editing (2026-09-01, Ben's request) — a competition's name
  // is only ever entered once, in the "New competition" form, before this
  // point. Same pencil-icon "tap to edit" pattern as member names in
  // AdminManagement.tsx.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(competition.name);
  const [savingName, setSavingName] = useState(false);

  async function saveCompetitionName() {
    const value = nameDraft.trim();
    if (!value) {
      toast.error("Name can't be empty.");
      return;
    }
    if (value === competition.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    const { error: saveError } = await supabase.from("competitions").update({ name: value }).eq("id", competition.id);
    setSavingName(false);
    if (saveError) {
      toast.error(`Couldn't rename: ${saveError.message}`);
      return;
    }
    setEditingName(false);
    onCompetitionChanged();
  }

  function cancelEditName() {
    setNameDraft(competition.name);
    setEditingName(false);
  }

  // Public, no-login live scoreboard (2026-09-08, Ben's request) — see
  // PublicScoreboard.tsx and the get_public_competition_scoreboard RPC
  // (0072 migration). Sharing the link is just this competition's own
  // public_share_token appended to a hash route; there's no separate
  // "share" table or state to keep in sync.
  const [savingShare, setSavingShare] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const scoreboardUrl = competition.public_share_token
    ? `${window.location.origin}${window.location.pathname}#scoreboard/${competition.public_share_token}`
    : "";

  async function enableScoreboard() {
    setSavingShare(true);
    const token = crypto.randomUUID();
    const { error: shareError } = await supabase
      .from("competitions")
      .update({ public_share_token: token })
      .eq("id", competition.id);
    setSavingShare(false);
    if (shareError) {
      toast.error(`Couldn't enable the public scoreboard: ${shareError.message}`);
      return;
    }
    onCompetitionChanged();
  }

  async function disableScoreboard() {
    setSavingShare(true);
    const { error: shareError } = await supabase
      .from("competitions")
      .update({ public_share_token: null })
      .eq("id", competition.id);
    setSavingShare(false);
    if (shareError) {
      toast.error(`Couldn't turn off the public scoreboard: ${shareError.message}`);
      return;
    }
    onCompetitionChanged();
  }

  async function copyScoreboardLink() {
    try {
      await navigator.clipboard.writeText(scoreboardUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — you can select and copy the link text instead.");
    }
  }
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

  if (loading) return <PageLoading label="Loading competition…" />;

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
          {editingName ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCompetitionName();
                  if (e.key === "Escape") cancelEditName();
                }}
                style={{
                  minWidth: 0,
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.4)",
                  background: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontSize: "1.2rem",
                  fontWeight: 700,
                }}
              />
              <button
                disabled={savingName || !nameDraft.trim()}
                onClick={saveCompetitionName}
                aria-label="Save competition name"
                style={{ width: "auto", flexShrink: 0, marginTop: 0, padding: "6px 10px", fontSize: "0.9rem" }}
              >
                ✓
              </button>
              <button
                disabled={savingName}
                onClick={cancelEditName}
                aria-label="Cancel editing name"
                style={{
                  width: "auto",
                  flexShrink: 0,
                  marginTop: 0,
                  padding: "6px 10px",
                  fontSize: "0.9rem",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.3)",
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <h2 style={{ margin: 0, color: "#fff", fontSize: "1.5rem", lineHeight: 1.2, display: "flex", alignItems: "center", gap: 8 }}>
              🏆 {competition.name}
              {isAdmin && (
                <button
                  onClick={() => {
                    setNameDraft(competition.name);
                    setEditingName(true);
                  }}
                  aria-label="Edit competition name"
                  style={{
                    width: "auto",
                    flexShrink: 0,
                    marginTop: 0,
                    padding: "2px 6px",
                    fontSize: "0.85rem",
                    lineHeight: 1,
                    background: "transparent",
                    color: "rgba(255,255,255,0.75)",
                    border: "none",
                  }}
                >
                  ✏️
                </button>
              )}
            </h2>
          )}
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
              // Pushes the button to the right edge of its flex line even
              // when it wraps onto its own row below the title on narrow
              // screens (2026-09-01, Ben's request) — plain
              // justify-content: space-between only right-aligns it when
              // there's a second item sharing that row.
              marginLeft: "auto",
              marginTop: 0,
              padding: "8px 14px",
              fontSize: "0.85rem",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              border: "1px solid var(--danger)",
            }}
            onClick={() => onDelete(competition.id)}
          >
            Delete competition
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>📡 Public live scoreboard</strong>
          <p className="stat-meta" style={{ marginTop: 4, marginBottom: 0 }}>
            A no-login link (and QR code) showing live standings and the bracket — share it or print the QR code
            for spectators to follow along at the courts.
          </p>
          {competition.public_share_token ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(scoreboardUrl)}`}
                alt="QR code linking to the public scoreboard"
                width={120}
                height={120}
                style={{ borderRadius: 8, border: "1px solid var(--border)", background: "#fff", padding: 4, flexShrink: 0 }}
              />
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <input
                  type="text"
                  readOnly
                  value={scoreboardUrl}
                  onFocus={(e) => e.target.select()}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.78rem" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={copyScoreboardLink}
                    style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
                  >
                    {linkCopied ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    disabled={savingShare}
                    onClick={disableScoreboard}
                    style={{
                      width: "auto",
                      marginTop: 0,
                      padding: "6px 12px",
                      fontSize: "0.82rem",
                      background: "transparent",
                      color: "var(--danger)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {savingShare ? "…" : "Turn off"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={savingShare}
              onClick={enableScoreboard}
              style={{ width: "auto", marginTop: 10, padding: "8px 14px" }}
            >
              {savingShare ? "…" : "Enable public scoreboard"}
            </button>
          )}
        </div>
      )}

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
          teams={teams}
          players={players}
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
          groups={groups}
          groupTeams={groupTeams}
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
          groups={groups}
          groupTeams={groupTeams}
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
  const confirm = useConfirm();
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [teamName, setTeamName] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  // Editing an existing team (2026-09-01, Ben's request) — previously the
  // only way to fix a wrong pairing was Remove + re-add from scratch. Only
  // offered here in SetupStage, i.e. only while the competition is still
  // "setup" — once the group stage starts, fixtures/matches reference
  // these team ids directly, so changing who's on a team after that point
  // would silently corrupt already-generated results.
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editP1, setEditP1] = useState("");
  const [editP2, setEditP2] = useState("");
  const [editTeamName, setEditTeamName] = useState("");
  const [savingEditTeam, setSavingEditTeam] = useState(false);
  const [editTeamError, setEditTeamError] = useState<string | null>(null);

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

  function startEditTeam(t: CompetitionTeamRow) {
    setEditingTeamId(t.id);
    setEditP1(t.player1_id);
    setEditP2(t.player2_id);
    setEditTeamName(t.team_name ?? "");
    setEditTeamError(null);
  }

  function cancelEditTeam() {
    setEditingTeamId(null);
    setEditTeamError(null);
  }

  async function saveEditTeam(teamId: string) {
    if (!editP1 || !editP2 || editP1 === editP2) return;
    setSavingEditTeam(true);
    setEditTeamError(null);
    const { error } = await supabase
      .from("competition_teams")
      .update({
        player1_id: editP1,
        player2_id: editP2,
        team_name: editTeamName.trim() || null,
      })
      .eq("id", teamId);
    setSavingEditTeam(false);
    if (error) {
      setEditTeamError(error.message);
      return;
    }
    setEditingTeamId(null);
    onChanged();
  }

  async function deleteTeam(teamId: string) {
    if (!(await confirm("Remove this team? Only possible before they've played any games.", { danger: true }))) return;
    const { error } = await supabase.from("competition_teams").delete().eq("id", teamId);
    if (error) {
      toast.error(`Couldn't remove team: ${error.message}`);
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
      toast.error(`Couldn't add group: ${error.message}`);
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
      toast.error(`Couldn't assign team: ${error.message}`);
      return;
    }
    onChanged();
  }

  async function unassignTeam(teamId: string) {
    const { error } = await supabase.from("competition_group_teams").delete().eq("team_id", teamId);
    if (error) {
      toast.error(`Couldn't unassign team: ${error.message}`);
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
    if (!(await confirm("Start the group stage? This creates every group's fixture list — you can still add results as you go."))) {
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
        round: f.round,
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
            {teams.map((t) =>
              editingTeamId === t.id ? (
                <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                  <label style={{ marginTop: 0 }}>Player 1</label>
                  <PlayerSelect
                    label=""
                    players={players}
                    value={editP1}
                    onChange={setEditP1}
                    disabledIds={[...usedPlayerIds].filter((id) => id !== t.player1_id && id !== t.player2_id).concat(editP2)}
                  />
                  <label>Player 2</label>
                  <PlayerSelect
                    label=""
                    players={players}
                    value={editP2}
                    onChange={setEditP2}
                    disabledIds={[...usedPlayerIds].filter((id) => id !== t.player1_id && id !== t.player2_id).concat(editP1)}
                  />
                  <label>Team name (optional)</label>
                  <input
                    type="text"
                    value={editTeamName}
                    onChange={(e) => setEditTeamName(e.target.value)}
                    placeholder="Defaults to both names"
                  />
                  {editTeamError && <p className="error">{editTeamError}</p>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button
                      disabled={savingEditTeam || !editP1 || !editP2 || editP1 === editP2}
                      onClick={() => saveEditTeam(t.id)}
                      style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "8px 14px", fontSize: "0.85rem" }}
                    >
                      {savingEditTeam ? "Saving…" : "Save"}
                    </button>
                    <button
                      disabled={savingEditTeam}
                      onClick={cancelEditTeam}
                      style={{
                        flex: "0 0 auto",
                        width: "auto",
                        marginTop: 0,
                        padding: "8px 14px",
                        fontSize: "0.85rem",
                        background: "transparent",
                        color: "var(--navy-500)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={t.id} className="match-row">
                  <div className="opponent">
                    {t.team_name || `${nameById(players, t.player1_id)} & ${nameById(players, t.player2_id)}`}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                    <span className="link-action" role="button" tabIndex={0} onClick={() => startEditTeam(t)}>
                      Edit
                    </span>
                    <span className="link-action" role="button" tabIndex={0} onClick={() => deleteTeam(t.id)}>
                      Remove
                    </span>
                  </div>
                </div>
              )
            )}
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
              <GroupCourtFields group={g} onChanged={onChanged} />
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

// Per-group court range (2026-09-07, Ben's request) — deliberately its own
// small component rather than inline state in SetupStage, since each
// group's draft values need to be independent and this keeps that
// isolated. Lives here in Setup (not at competition-creation time) because
// by the point you're setting up groups you usually know the day's actual
// court layout, whereas that's rarely known when the competition is first
// created. Saved on blur rather than on every keystroke — a group's court
// numbers aren't read anywhere until fixtures are generated and viewed, so
// there's no need to write on every character typed.
function GroupCourtFields({ group, onChanged }: { group: CompetitionGroupRow; onChanged: () => void }) {
  const [startCourt, setStartCourt] = useState(group.start_court?.toString() ?? "");
  const [courtCount, setCourtCount] = useState(group.court_count?.toString() ?? "");

  async function save() {
    const parsedStart = startCourt.trim() ? Number(startCourt) : null;
    const parsedCount = courtCount.trim() ? Number(courtCount) : null;
    if (parsedStart === group.start_court && parsedCount === group.court_count) return;
    await supabase
      .from("competition_groups")
      .update({ start_court: parsedStart, court_count: parsedCount })
      .eq("id", group.id);
    onChanged();
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
      <div style={{ flex: "0 0 auto" }}>
        <label style={{ marginTop: 0, fontSize: "0.78rem" }}>Starting court</label>
        <input
          type="number"
          min={1}
          value={startCourt}
          onChange={(e) => setStartCourt(e.target.value)}
          onBlur={save}
          placeholder="e.g. 1"
          style={{ maxWidth: 90 }}
        />
      </div>
      <div style={{ flex: "0 0 auto" }}>
        <label style={{ marginTop: 0, fontSize: "0.78rem" }}>Number of courts</label>
        <input
          type="number"
          min={1}
          value={courtCount}
          onChange={(e) => setCourtCount(e.target.value)}
          onBlur={save}
          placeholder="e.g. 2"
          style={{ maxWidth: 90 }}
        />
      </div>
    </div>
  );
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
  teams,
  players,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
}: {
  competition: CompetitionRow;
  groups: CompetitionGroupRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teams: CompetitionTeamRow[];
  players: PlayerStatus[];
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [advancing, setAdvancing] = useState(false);

  // Edit teams before knockout (2026-09-07, Ben's request: "can I still
  // have an option to go back and re-edit the teams? Just in case there's
  // been an error?"). Previously pairings could only be fixed in Setup,
  // before the group stage even started. Editing player1_id/player2_id on
  // competition_teams here is safe even mid-stage — it doesn't touch
  // competition_matches or already-recorded results at all, since a
  // played game's score is submitted against the exact players on the
  // team AT THAT MOMENT (see FixtureRow.submit) and stored independently
  // from here on. The only reason to still gate it is display, not data
  // integrity: once a team's played a game, changing its roster would
  // make the on-screen label stop matching who actually played that
  // earlier game, which would just be confusing. So teams stay freely
  // editable right up until their first played group game, same
  // affordance as SetupStage's team edit, just available later too.
  const [showEditTeams, setShowEditTeams] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editP1, setEditP1] = useState("");
  const [editP2, setEditP2] = useState("");
  const [editTeamName, setEditTeamName] = useState("");
  const [savingEditTeam, setSavingEditTeam] = useState(false);
  const [editTeamError, setEditTeamError] = useState<string | null>(null);

  const usedPlayerIds = new Set(teams.flatMap((t) => [t.player1_id, t.player2_id]));
  const playedTeamIds = new Set(matches.filter((m) => m.matches).flatMap((m) => [m.team_a_id, m.team_b_id]));

  function startEditTeam(t: CompetitionTeamRow) {
    setEditingTeamId(t.id);
    setEditP1(t.player1_id);
    setEditP2(t.player2_id);
    setEditTeamName(t.team_name ?? "");
    setEditTeamError(null);
  }

  function cancelEditTeam() {
    setEditingTeamId(null);
    setEditTeamError(null);
  }

  async function saveEditTeam(teamId: string) {
    if (!editP1 || !editP2 || editP1 === editP2) return;
    setSavingEditTeam(true);
    setEditTeamError(null);
    const { error } = await supabase
      .from("competition_teams")
      .update({ player1_id: editP1, player2_id: editP2, team_name: editTeamName.trim() || null })
      .eq("id", teamId);
    setSavingEditTeam(false);
    if (error) {
      setEditTeamError(error.message);
      return;
    }
    setEditingTeamId(null);
    onChanged();
  }
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
    const proceed = await confirm(
      unplayed > 0
        ? `${unplayed} group game(s) haven't been played yet. Move to the knockout stage anyway?`
        : "Move to the knockout stage?"
    );
    if (!proceed) return;
    setAdvancing(true);
    const { error } = await supabase.from("competitions").update({ status: "knockout" }).eq("id", competition.id);
    setAdvancing(false);
    if (error) {
      toast.error(`Couldn't advance: ${error.message}`);
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
      {isAdmin && (
        <div style={{ marginBottom: 16 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowEditTeams(!showEditTeams)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <strong style={{ fontSize: "0.9rem", color: "var(--danger)" }}>Edit teams</strong>
            <span style={{ color: "var(--danger)", fontWeight: 700, fontSize: "0.85rem" }}>
              {showEditTeams ? "Hide ▲" : "Show ▼"}
            </span>
          </div>
          {showEditTeams && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <p className="stat-meta" style={{ marginTop: 0 }}>
                Catch a wrong pairing before it's played. Once a team's played a group game its lineup locks —
                edit the score instead if a game itself was entered wrong.
              </p>
              {teams.map((t) => {
                const locked = playedTeamIds.has(t.id);
                if (editingTeamId === t.id) {
                  return (
                    <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                      <label style={{ marginTop: 0 }}>Player 1</label>
                      <PlayerSelect
                        label=""
                        players={players}
                        value={editP1}
                        onChange={setEditP1}
                        disabledIds={[...usedPlayerIds]
                          .filter((id) => id !== t.player1_id && id !== t.player2_id)
                          .concat(editP2)}
                      />
                      <label>Player 2</label>
                      <PlayerSelect
                        label=""
                        players={players}
                        value={editP2}
                        onChange={setEditP2}
                        disabledIds={[...usedPlayerIds]
                          .filter((id) => id !== t.player1_id && id !== t.player2_id)
                          .concat(editP1)}
                      />
                      <label>Team name (optional)</label>
                      <input
                        type="text"
                        value={editTeamName}
                        onChange={(e) => setEditTeamName(e.target.value)}
                        placeholder="Defaults to both names"
                      />
                      {editTeamError && <p className="error">{editTeamError}</p>}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button
                          disabled={savingEditTeam || !editP1 || !editP2 || editP1 === editP2}
                          onClick={() => saveEditTeam(t.id)}
                          style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "8px 14px", fontSize: "0.85rem" }}
                        >
                          {savingEditTeam ? "Saving…" : "Save"}
                        </button>
                        <button
                          disabled={savingEditTeam}
                          onClick={cancelEditTeam}
                          style={{
                            flex: "0 0 auto",
                            width: "auto",
                            marginTop: 0,
                            padding: "8px 14px",
                            fontSize: "0.85rem",
                            background: "transparent",
                            color: "var(--navy-500)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={t.id} className="match-row">
                    <div className="opponent">
                      {t.team_name || `${nameById(players, t.player1_id)} & ${nameById(players, t.player2_id)}`}
                    </div>
                    {locked ? (
                      <span className="stat-meta" style={{ flexShrink: 0 }}>
                        Played — locked
                      </span>
                    ) : (
                      <span className="link-action" role="button" tabIndex={0} onClick={() => startEditTeam(t)}>
                        Edit
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {groupsToShow.map((g) => {
        const groupMatches = matches.filter((m) => m.group_id === g.id);
        // Round/Court layout (2026-09-07, Ben's request) — only kicks in
        // once a group has both start_court and court_count set (see
        // GroupCourtFields in SetupStage); otherwise scheduleFixturesByCourt
        // hands every match back with printedRound/court both null and this
        // renders exactly as it always did, a flat list in fixture order.
        const scheduled = scheduleFixturesByCourt(groupMatches, g.start_court ?? 0, g.court_count ?? 0);
        const isScheduled = scheduled.some((m) => m.printedRound != null);
        if (!isScheduled) {
          return (
            <div key={g.id} style={{ marginBottom: 16, marginTop: groups.length > 1 ? 16 : 0 }}>
              <strong>{g.name}</strong>
              {groupMatches.map((m) => (
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
        }
        const byPrintedRound = new Map<number, typeof scheduled>();
        for (const m of scheduled) {
          const key = m.printedRound ?? 0;
          const list = byPrintedRound.get(key) ?? [];
          list.push(m);
          byPrintedRound.set(key, list);
        }
        const printedRounds = [...byPrintedRound.keys()].sort((a, b) => a - b);
        return (
          <div key={g.id} style={{ marginBottom: 16, marginTop: groups.length > 1 ? 16 : 0 }}>
            <strong>{g.name}</strong>
            {printedRounds.map((round) => (
              <div key={round} style={{ marginTop: 10 }}>
                <div className="stat-meta" style={{ fontWeight: 700, marginBottom: 2 }}>
                  Round {round}
                </div>
                {byPrintedRound.get(round)!.map((m) => (
                  <FixtureRow
                    key={m.id}
                    match={m}
                    teamLabel={teamLabel}
                    isAdmin={isAdmin}
                    currentUserId={currentUserId}
                    onChanged={onChanged}
                    locked={competition.status === "completed"}
                    courtLabel={m.court != null ? `Court ${m.court}` : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        );
      })}
      {isAdmin && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            disabled={advancing}
            onClick={advanceToKnockout}
            style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
          >
            {advancing ? "Advancing…" : "Advance to knockout stage"}
          </button>
          <button
            onClick={() => {
              // Exports EVERY group's fixtures, not just whichever one is
              // currently shown in the group switcher above — an admin
              // printing a hard copy for the day needs the whole thing.
              const blob = buildFixturesDocxBlob(competition, groups, matches, teamLabel);
              downloadBlob(`${competition.name.replace(/[/\\?%*:|"<>]/g, "-")} - Fixtures.docx`, blob);
            }}
            style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
          >
            Save fixtures as Word doc
          </button>
        </div>
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
  courtLabel,
}: {
  match: CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null };
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
  locked: boolean;
  // "Court N" chip (2026-09-07) — set when the fixture's group has court
  // scheduling configured (see GroupFixturesSection/scheduleFixturesByCourt).
  // Undefined for knockout matches and unscheduled groups, same as before.
  courtLabel?: string;
}) {
  const confirm = useConfirm();
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
      !(await confirm(
        `Change the score to ${teamAScore}–${teamBScore}? Ratings get recalculated from the corrected match history afterward.`
      ))
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
        {courtLabel && (
          <span
            style={{
              display: "inline-block",
              marginLeft: 8,
              padding: "1px 8px",
              borderRadius: 999,
              background: "var(--bg-subtle, rgba(15,37,71,0.06))",
              color: "var(--navy-500)",
              fontSize: "0.72rem",
              fontWeight: 700,
              verticalAlign: "middle",
            }}
          >
            {courtLabel}
          </span>
        )}
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
  groups,
  groupTeams,
  matches,
  teamLabel,
  isAdmin,
  currentUserId,
  onChanged,
}: {
  competition: CompetitionRow;
  teams: CompetitionTeamRow[];
  groups: CompetitionGroupRow[];
  groupTeams: CompetitionGroupTeamRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [round, setRound] = useState<KnockoutRound>("quarterfinal");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const knockoutMatches = matches.filter((m) => m.knockout_round);

  // Which teams are actually eligible for the bracket (2026-09-07, Ben's
  // request): the top `advance_per_group` finishers from EACH group, same
  // math as GroupStandingsSection's bolding above — reusing
  // computeGroupStandings rather than re-deriving standings a different
  // way. If there's no group stage at all (groups.length === 0, e.g. a
  // straight knockout with no group phase), there's nothing to qualify
  // from, so every team stays selectable rather than showing an empty list.
  const qualifiedTeamIds = useMemo(() => {
    if (groups.length === 0) return null;
    const qualified = new Set<string>();
    for (const g of groups) {
      const teamIds = groupTeams.filter((gt) => gt.group_id === g.id).map((gt) => gt.team_id);
      const played = matches
        .filter((m) => m.group_id === g.id && m.matches)
        .map((m) => ({
          teamAId: m.team_a_id,
          teamBId: m.team_b_id,
          teamAScore: m.matches!.team_a_score,
          teamBScore: m.matches!.team_b_score,
        }));
      const standings = computeGroupStandings(teamIds, played, competition.scoring_system);
      standings.slice(0, competition.advance_per_group).forEach((row) => qualified.add(row.teamId));
    }
    return qualified;
  }, [groups, groupTeams, matches, competition.scoring_system, competition.advance_per_group]);

  const selectableTeams = qualifiedTeamIds ? teams.filter((t) => qualifiedTeamIds.has(t.id)) : teams;
  const hiddenTeamCount = teams.length - selectableTeams.length;

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
    if (!(await confirm("Mark this competition complete and record final placements? This shows on the Club Stats page."))) {
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
          {qualifiedTeamIds && hiddenTeamCount > 0 && (
            <p className="stat-meta" style={{ marginTop: 4 }}>
              Only showing the {selectableTeams.length} team{selectableTeams.length === 1 ? "" : "s"} that qualified
              from the group stage ({hiddenTeamCount} that didn't are hidden).
            </p>
          )}
          <label>Team A</label>
          <select value={teamA} onChange={(e) => setTeamA(e.target.value)}>
            <option value="">Select team…</option>
            {selectableTeams.map((t) => (
              <option key={t.id} value={t.id} disabled={t.id === teamB}>
                {teamLabel(t.id)}
              </option>
            ))}
          </select>
          <label>Team B</label>
          <select value={teamB} onChange={(e) => setTeamB(e.target.value)}>
            <option value="">Select team…</option>
            {selectableTeams.map((t) => (
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
  groups,
  groupTeams,
  matches,
  teamLabel,
  isAdmin,
  onChanged,
}: {
  competition: CompetitionRow;
  teams: CompetitionTeamRow[];
  groups: CompetitionGroupRow[];
  groupTeams: CompetitionGroupTeamRow[];
  matches: (CompetitionMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
  teamLabel: (id: string) => string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [results, setResults] = useState<{ placement: number; team_id: string }[]>([]);
  const [reopening, setReopening] = useState(false);
  // Pre-match ratings per (match, player) — 2026-09-07, Ben's request for
  // an "overachiever" stat. Fetched separately here rather than folded
  // into the shared competition_matches query every other section uses,
  // since this is the only place that needs it. Keyed "matchId:playerId"
  // for O(1) lookup below.
  const [preRatings, setPreRatings] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const matchIds = matches.map((m) => m.match_id).filter((id): id is string => !!id);
    if (matchIds.length === 0) {
      setPreRatings(new Map());
      return;
    }
    supabase
      .from("match_participant_ratings")
      .select("match_id, player_id, pre_rating")
      .in("match_id", matchIds)
      .then(({ data }) => {
        const map = new Map<string, number>();
        for (const row of data ?? []) {
          map.set(`${row.match_id}:${row.player_id}`, row.pre_rating);
        }
        setPreRatings(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition.id]);

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

  // Closest match — smallest margin of victory in any single played match.
  // Added 2026-09-07 at Ben's request, alongside a couple more stats below
  // — framed the same positive way as Biggest win above: it names the
  // winner of a tight, exciting game rather than calling out who "nearly
  // lost". Same shape as biggestWin, just the opposite end of the margin.
  let closestMatch: { winnerId: string; loserId: string; winnerScore: number; loserScore: number; margin: number } | null = null;
  for (const m of matches) {
    if (!m.matches || !m.winner_team_id) continue;
    const winnerIsA = m.winner_team_id === m.team_a_id;
    const winnerScore = winnerIsA ? m.matches.team_a_score : m.matches.team_b_score;
    const loserScore = winnerIsA ? m.matches.team_b_score : m.matches.team_a_score;
    const margin = winnerScore - loserScore;
    if (margin > 0 && (!closestMatch || margin < closestMatch.margin)) {
      closestMatch = {
        winnerId: m.winner_team_id,
        loserId: winnerIsA ? m.team_b_id : m.team_a_id,
        winnerScore,
        loserScore,
        margin,
      };
    }
  }

  // Total points played — a pure aggregate across every match in the
  // competition, not attached to any one team, so there's no way for it to
  // read as a dig at anyone. Just a fun "how much pickleball did we play"
  // number for the recap.
  let totalPointsPlayed = 0;
  for (const m of matches) {
    if (!m.matches) continue;
    totalPointsPlayed += m.matches.team_a_score + m.matches.team_b_score;
  }

  // Unbeaten in groups — team(s) that went through their ENTIRE group
  // stage without a single loss. Reuses computeGroupStandings, same as
  // GroupStandingsSection during the groups stage, scoped per group since
  // a team's group-stage record only makes sense within its own group.
  // Purely a positive footnote about the group phase, separate from who
  // ultimately won the whole competition — a team can go unbeaten in
  // groups and still not take the title, and this is a nice thing to call
  // out for them regardless.
  const unbeatenInGroups: string[] = [];
  for (const g of groups) {
    const teamIds = groupTeams.filter((gt) => gt.group_id === g.id).map((gt) => gt.team_id);
    const played = matches
      .filter((m) => m.group_id === g.id && m.matches)
      .map((m) => ({
        teamAId: m.team_a_id,
        teamBId: m.team_b_id,
        teamAScore: m.matches!.team_a_score,
        teamBScore: m.matches!.team_b_score,
      }));
    const standings = computeGroupStandings(teamIds, played, competition.scoring_system);
    for (const row of standings) {
      if (row.played > 0 && row.lost === 0) unbeatenInGroups.push(row.teamId);
    }
  }

  // Overachiever — 2026-09-07, Ben's request: "a team who performed better
  // than their Rating suggested they would". Same underlying idea as
  // Leaderboard's "Biggest Upset" card (a win where the winning side's
  // average pre-match rating was LOWER than the losing side's — i.e. they
  // were the "underdog" by rating, on paper, for that game), but summed
  // across every game in the competition rather than spotlighting one, so
  // it rewards a team that consistently punched above their rating rather
  // than just the single biggest one-off shock. Only positive gaps count
  // (being outrated and STILL winning) — a win as the favourite contributes
  // nothing here, it just doesn't count against them either.
  function avgPreRating(matchId: string | null, team: CompetitionTeamRow | undefined): number | null {
    if (!matchId || !team) return null;
    const a = preRatings.get(`${matchId}:${team.player1_id}`);
    const b = preRatings.get(`${matchId}:${team.player2_id}`);
    if (a == null || b == null) return null;
    return (a + b) / 2;
  }
  const overachieveByTeam = new Map<string, number>();
  for (const m of matches) {
    if (!m.matches || !m.winner_team_id || !m.match_id) continue;
    const loserTeamId = m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id;
    const winnerTeam = teams.find((t) => t.id === m.winner_team_id);
    const loserTeam = teams.find((t) => t.id === loserTeamId);
    const winnerAvg = avgPreRating(m.match_id, winnerTeam);
    const loserAvg = avgPreRating(m.match_id, loserTeam);
    if (winnerAvg == null || loserAvg == null) continue;
    const gap = loserAvg - winnerAvg;
    if (gap > 0) {
      overachieveByTeam.set(m.winner_team_id, (overachieveByTeam.get(m.winner_team_id) ?? 0) + gap);
    }
  }
  let overachiever: { teamId: string; points: number } | null = null;
  for (const [teamId, points] of overachieveByTeam) {
    if (!overachiever || points > overachiever.points) overachiever = { teamId, points: Math.round(points) };
  }

  async function reopenCompetition() {
    if (
      !(await confirm(
        "Reopen this competition? It'll move back to the knockout stage so results can be corrected — the recorded final placements will be cleared until you mark it complete again."
      ))
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

      {(topScorer || biggestWin || closestMatch || totalPointsPlayed > 0 || unbeatenInGroups.length > 0 || overachiever) && (
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
          {closestMatch && (
            <div style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))", border: "1px solid var(--border)" }}>
              <div className="stat-meta" style={{ margin: 0 }}>😅 Closest match</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{teamLabel(closestMatch.winnerId)}</div>
              <div className="stat-meta" style={{ marginTop: 2 }}>
                Beat {teamLabel(closestMatch.loserId)} {closestMatch.winnerScore}–{closestMatch.loserScore} — right down to the wire
              </div>
            </div>
          )}
          {unbeatenInGroups.length > 0 && (
            <div style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))", border: "1px solid var(--border)" }}>
              <div className="stat-meta" style={{ margin: 0 }}>🛡️ Unbeaten in groups</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{unbeatenInGroups.map((id) => teamLabel(id)).join(", ")}</div>
              <div className="stat-meta" style={{ marginTop: 2 }}>
                Went through the group stage without dropping a single game.
              </div>
            </div>
          )}
          {totalPointsPlayed > 0 && (
            <div style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))", border: "1px solid var(--border)" }}>
              <div className="stat-meta" style={{ margin: 0 }}>🎾 Points played</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{totalPointsPlayed}</div>
              <div className="stat-meta" style={{ marginTop: 2 }}>Total points scored across every game in the competition.</div>
            </div>
          )}
          {overachiever && (
            <div style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))", border: "1px solid var(--border)" }}>
              <div className="stat-meta" style={{ margin: 0 }}>📈 Overachiever</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{teamLabel(overachiever.teamId)}</div>
              <div className="stat-meta" style={{ marginTop: 2 }}>
                Won games against opponents who out-rated them by a combined {overachiever.points} points.
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
