import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import type { LegacyBadgeRow, MatchAuditLogRow, PlayerPrivateInfo, PlayerStatus } from "../types";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import PageLoading from "../components/PageLoading";
import MemberList from "../components/MemberList";

const ERROR_LOG_LIMIT = 50;
const MATCH_AUDIT_LOG_LIMIT = 100;

// Reusable collapsible settings section (2026-08-29, Ben's request to
// "clean up" this page) — Invite code / Competitions tab / Ratings / Error
// logs all default to collapsed since they're occasional admin actions,
// not something looked at on every visit, unlike the always-open member
// list below. An optional subtitle (e.g. current on/off state, or an error
// count) stays visible even while collapsed, so there's still a
// quick-glance signal without needing to open the section.
function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {subtitle && !open && <p className="stat-meta" style={{ margin: "2px 0 0" }}>{subtitle}</p>}
        </div>
        <span style={{ color: "var(--navy-500)", fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>
          {open ? "Hide ▲" : "Show ▼"}
        </span>
      </div>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

// Added 2026-08-25 alongside src/lib/errorLogging.ts — see that file for
// how these rows get written. Kept local to this file since nothing else
// in the app needs this shape.
interface ClientErrorLog {
  id: string;
  created_at: string;
  player_id: string | null;
  message: string;
  stack: string | null;
  source: string | null;
  page_path: string | null;
  user_agent: string | null;
  players: { display_name: string } | null;
}

// Club settings + admin roster screen — replaces the earlier "hardcoded
// admin emails" approach. Any existing admin can promote/demote other
// admins, and the same per-member actions (deactivate, reset rating
// history, delete, legacy badges) are available here for admins
// themselves via the shared MemberList component (see
// src/components/MemberList.tsx).
//
// Split 2026-09-24 (Ben: this page "keeps getting pushed down" as more
// settings sections were added) — everyone who ISN'T an admin now lives
// on the separate Player List page/tab instead, which is where the
// search box and full member roster live. This page only ever shows the
// (short) admin list, so no search bar is needed here.
export default function AdminManagement({
  currentUserId,
  onSelectPlayer,
}: {
  currentUserId: string;
  // Lets an admin tap a member's photo/name here to open their full
  // Dashboard (same view the Leaderboard's click-through uses) — added
  // 2026-08-28 at Ben's request, so admins don't have to hunt for someone
  // on the Leaderboard just to check their profile.
  onSelectPlayer?: (id: string, name: string) => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  // Emergency contact + medical info (2026-08-31) — moved out of
  // player_status into their own RLS-locked table (see types.ts's
  // PlayerPrivateInfo comment), so they're fetched separately here and
  // merged in by player_id rather than coming along with the main
  // player_status rows. As an admin, is_admin() lets this fetch return
  // every player's row, not just the signed-in admin's own.
  const [privateInfoByPlayer, setPrivateInfoByPlayer] = useState<Record<string, PlayerPrivateInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  // The one shared code new members enter to join — see InviteGate.tsx and
  // the redeem_invite_code() function. Anyone who doesn't have this code
  // can't get a player profile, even if they sign in with Google.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [codeSaved, setCodeSaved] = useState(false);

  // Competitions tab visibility (2026-08-26) — off by default so it
  // doesn't clutter navigation between events; admins always see the tab
  // regardless of this setting, so they can set the next one up ahead of
  // time.
  const [showCompetitionsTab, setShowCompetitionsTab] = useState(false);
  const [savingCompetitionsTab, setSavingCompetitionsTab] = useState(false);

  // Quarterly Cup tab visibility (2026-09-02) — same reasoning and pattern
  // as the Competitions tab above, for the standalone mini-league.
  const [showQuarterlyCupTab, setShowQuarterlyCupTab] = useState(false);
  const [savingQuarterlyCupTab, setSavingQuarterlyCupTab] = useState(false);

  // Client-side error logs (2026-08-25) — see src/lib/errorLogging.ts.
  const [errorLogs, setErrorLogs] = useState<ClientErrorLog[]>([]);
  const [errorLogsLoading, setErrorLogsLoading] = useState(true);
  // Match score audit log (2026-09-24) — who edited or deleted a
  // confirmed match's score, and what it changed to/from. Player names
  // are resolved client-side against the `players` list already loaded
  // above rather than via an embedded join, since the log has 5 separate
  // player-id columns (performed_by plus the 4 team slots) and Postgrest
  // needs an FK hint per embedded relation, which gets unwieldy fast for
  // one row shape.
  const [matchAuditLog, setMatchAuditLog] = useState<MatchAuditLogRow[]>([]);
  const [matchAuditLogLoading, setMatchAuditLogLoading] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Legacy badges (2026-08-28) — the one manually-grantable badge, for
  // real achievements that predate this app's own records (see
  // legacy_badges migration). Fetched once for every player, then grouped
  // by player_id client-side rather than one query per card.
  const [legacyBadges, setLegacyBadges] = useState<LegacyBadgeRow[]>([]);

  // Placeholder/dummy players (2026-09-01) — for members reluctant to sign
  // up themselves who still need to be registered in matches/competitions.
  // See create-placeholder-player edge function for how this is created.
  const [placeholderName, setPlaceholderName] = useState("");
  const [creatingPlaceholder, setCreatingPlaceholder] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from("player_status").select("*").order("display_name"),
      supabase.from("player_private_info").select("*"),
    ]).then(([{ data, error }, { data: privateRows }]) => {
        setPrivateInfoByPlayer(
          Object.fromEntries(((privateRows ?? []) as PlayerPrivateInfo[]).map((r) => [r.player_id, r]))
        );
        if (error) {
          setError(error.message);
        } else {
          setPlayers((data ?? []) as PlayerStatus[]);
        }
        setLoading(false);
      });
  }

  function loadInviteCode() {
    supabase
      .from("club_settings")
      .select("invite_code, show_competitions_tab, show_quarterly_cup_tab")
      .single()
      .then(({ data }) => {
        setInviteCode(data?.invite_code ?? null);
        setInviteCodeInput(data?.invite_code ?? "");
        setShowCompetitionsTab(!!data?.show_competitions_tab);
        setShowQuarterlyCupTab(!!data?.show_quarterly_cup_tab);
      });
  }

  async function toggleCompetitionsTab() {
    const next = !showCompetitionsTab;
    setSavingCompetitionsTab(true);
    const { error } = await supabase
      .from("club_settings")
      .update({ show_competitions_tab: next, updated_at: new Date().toISOString() })
      .eq("id", true);
    setSavingCompetitionsTab(false);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      return;
    }
    setShowCompetitionsTab(next);
  }

  async function toggleQuarterlyCupTab() {
    const next = !showQuarterlyCupTab;
    setSavingQuarterlyCupTab(true);
    const { error } = await supabase
      .from("club_settings")
      .update({ show_quarterly_cup_tab: next, updated_at: new Date().toISOString() })
      .eq("id", true);
    setSavingQuarterlyCupTab(false);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      return;
    }
    setShowQuarterlyCupTab(next);
  }

  function loadErrorLogs() {
    setErrorLogsLoading(true);
    supabase
      .from("client_error_logs")
      .select("*, players(display_name)")
      .order("created_at", { ascending: false })
      .limit(ERROR_LOG_LIMIT)
      .then(({ data, error }) => {
        if (!error && data) {
          setErrorLogs(data as unknown as ClientErrorLog[]);
        }
        setErrorLogsLoading(false);
      });
  }

  async function clearErrorLogs() {
    if (!(await confirm(`Clear all ${errorLogs.length} logged error${errorLogs.length === 1 ? "" : "s"}?`, { danger: true }))) return;
    setClearingLogs(true);
    const { error } = await supabase.from("client_error_logs").delete().not("id", "is", null);
    setClearingLogs(false);
    if (error) {
      toast.error(`Couldn't clear error logs: ${error.message}`);
      return;
    }
    loadErrorLogs();
  }

  function loadMatchAuditLog() {
    setMatchAuditLogLoading(true);
    supabase
      .from("match_score_audit_log")
      .select("*")
      .order("performed_at", { ascending: false })
      .limit(MATCH_AUDIT_LOG_LIMIT)
      .then(({ data, error }) => {
        if (!error) setMatchAuditLog((data ?? []) as MatchAuditLogRow[]);
        setMatchAuditLogLoading(false);
      });
  }

  function loadLegacyBadges() {
    supabase
      .from("legacy_badges")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setLegacyBadges((data ?? []) as LegacyBadgeRow[]);
      });
  }

  useEffect(load, []);
  useEffect(loadInviteCode, []);
  useEffect(loadErrorLogs, []);
  useEffect(loadMatchAuditLog, []);
  useEffect(loadLegacyBadges, []);

  const playerNameById = useMemo(() => new Map(players.map((p) => [p.id, p.display_name])), [players]);

  async function saveInviteCode() {
    if (!inviteCodeInput.trim()) return;
    setSavingCode(true);
    setCodeSaved(false);
    const { error } = await supabase
      .from("club_settings")
      .update({ invite_code: inviteCodeInput.trim(), updated_at: new Date().toISOString() })
      .eq("id", true);
    setSavingCode(false);
    if (error) {
      toast.error(`Couldn't save: ${error.message}`);
      return;
    }
    setInviteCode(inviteCodeInput.trim());
    setCodeSaved(true);
  }

  function generateRandomCode() {
    const random = Math.random().toString(36).slice(2, 10).toUpperCase();
    setInviteCodeInput(random);
    setCodeSaved(false);
  }

  // Rebuilds EVERY player's rating from the complete confirmed match
  // history, replayed from scratch in chronological order — see
  // supabase/functions/recompute-ratings/replay.ts. Deleting an older
  // game (from Game history) already triggers this automatically
  // afterward, so this button is really for general peace of mind: run
  // it any time to confirm every rating matches what the full match log
  // actually supports.
  async function recomputeHistory() {
    if (
      !(await confirm(
        "Recalculate every player's rating from the complete match history? This rebuilds everyone's rating from scratch based on every confirmed game, in order — useful as a sanity check, but not something you'd normally need to run."
      ))
    ) {
      return;
    }
    setRecomputing(true);
    const attemptedAt = Date.now();
    const { error } = await supabase.functions.invoke("recompute-ratings", { body: {} });
    setRecomputing(false);
    if (error) {
      // Same false-failure class as reset-player — invoke() can report a
      // client-side error even when the recompute actually completed.
      // Every player's player_ratings row gets a fresh updated_at as part
      // of the rebuild, so a very recent one is a reliable "it worked"
      // signal even though there's no single row to point at.
      const { data: recheck } = await supabase
        .from("player_ratings")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const justRecomputed =
        !!recheck?.updated_at && new Date(recheck.updated_at).getTime() > attemptedAt - 5000;
      if (justRecomputed) {
        toast.success("Done — every player's rating has been recalculated from the full match history.");
        load();
        return;
      }
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        toast.error(body?.error ?? "Couldn't recompute ratings.");
      } else {
        toast.error("Couldn't reach the server to recompute ratings — check your connection and try again.");
      }
      return;
    }
    toast.success("Done — every player's rating has been recalculated from the full match history.");
    load();
  }

  // Creates a placeholder player via the service-role edge function (needs
  // a real, permanently-banned auth.users row behind the scenes — see that
  // function's comment) then reloads the member list so the new "Guest"
  // shows up immediately, ready to be picked in Match Entry/Competitions.
  async function createPlaceholderPlayer() {
    const name = placeholderName.trim();
    if (!name) return;
    setCreatingPlaceholder(true);
    const { error } = await supabase.functions.invoke("create-placeholder-player", {
      body: { display_name: name },
    });
    setCreatingPlaceholder(false);
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        toast.error(body?.error ?? "Couldn't add this player.");
      } else {
        toast.error("Couldn't reach the server to add this player — check your connection and try again.");
      }
      return;
    }
    toast.success(`${name} added as a guest player`);
    setPlaceholderName("");
    load();
  }

  if (loading) return <PageLoading label="Loading players…" />;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Admins</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Club-wide settings, plus the admin roster itself. Everyone else lives on the Player list page.
      </p>

      <CollapsibleCard title="Invite code">
        <p className="stat-meta" style={{ marginTop: 0 }}>
          New members need this code to join — signing in with Google alone isn't enough. Share it however
          suits the club (WhatsApp, a printed sheet, etc.), and change it any time below.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <input
            type="text"
            value={inviteCodeInput}
            onChange={(e) => {
              setInviteCodeInput(e.target.value);
              setCodeSaved(false);
            }}
            placeholder="e.g. A1B2C3D4"
            style={{ flex: "1 1 160px", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <button
            onClick={generateRandomCode}
            style={{
              flex: "0 0 auto",
              width: "auto",
              marginTop: 0,
              background: "transparent",
              color: "var(--navy-500)",
              border: "1px solid var(--border)",
            }}
          >
            Generate
          </button>
        </div>
        <button
          disabled={savingCode || !inviteCodeInput.trim() || inviteCodeInput.trim() === inviteCode}
          onClick={saveInviteCode}
          style={{ marginTop: 12 }}
        >
          {savingCode ? "Saving…" : "Save code"}
        </button>
        {codeSaved && (
          <p className="stat-meta" style={{ color: "var(--success)", marginTop: 8 }}>
            Saved — the previous code no longer works.
          </p>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Competitions tab" subtitle={showCompetitionsTab ? "Visible to everyone" : "Hidden from members"}>
        <p className="stat-meta" style={{ marginTop: 0 }}>
          Off by default so it doesn't clutter navigation between events. Turn it on for regular members while a
          competition is being run — admins can always see and set up competitions either way.
        </p>
        <button
          disabled={savingCompetitionsTab}
          onClick={toggleCompetitionsTab}
          style={
            showCompetitionsTab
              ? {}
              : { background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }
          }
        >
          {savingCompetitionsTab ? "…" : showCompetitionsTab ? "Visible to everyone — turn off" : "Hidden from members — turn on"}
        </button>
      </CollapsibleCard>

      <CollapsibleCard
        title="Quarterly Cup tab"
        subtitle={showQuarterlyCupTab ? "Visible to everyone" : "Only entered players"}
      >
        <p className="stat-meta" style={{ marginTop: 0 }}>
          Players entered into a Quarterly Cup team can always see the tab, even with this off (2026-09-02) — this
          only controls whether everyone else sees it too. Off by default so it doesn't clutter navigation for
          members not taking part; admins can always see and set one up either way.
        </p>
        <button
          disabled={savingQuarterlyCupTab}
          onClick={toggleQuarterlyCupTab}
          style={
            showQuarterlyCupTab
              ? {}
              : { background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }
          }
        >
          {savingQuarterlyCupTab ? "…" : showQuarterlyCupTab ? "Visible to everyone — turn off" : "Only entered players — turn on for everyone"}
        </button>
      </CollapsibleCard>

      <CollapsibleCard title="Ratings">
        <p className="stat-meta" style={{ marginTop: 0 }}>
          Deleting an older game (in Game history) automatically recalculates everyone's rating afterward, so
          this shouldn't normally be needed. It's here as a sanity check — recalculates every player's rating
          from scratch, from the complete confirmed match history, in order.
        </p>
        <button
          disabled={recomputing}
          onClick={recomputeHistory}
          style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
        >
          {recomputing ? "Recomputing…" : "Recompute history"}
        </button>
      </CollapsibleCard>

      <CollapsibleCard
        title="Score edit & delete log"
        subtitle={
          matchAuditLogLoading ? undefined : matchAuditLog.length === 0 ? "Nothing logged" : `${matchAuditLog.length} logged`
        }
      >
        <p className="stat-meta" style={{ marginTop: 0 }}>
          Every score correction or deletion done from Game history, so it's answerable here directly rather than
          needing to dig through raw logs afterward.
        </p>
        {matchAuditLogLoading ? (
          <p className="stat-meta">Loading…</p>
        ) : matchAuditLog.length === 0 ? (
          <p className="stat-meta">No corrections or deletions logged yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {matchAuditLog.map((entry) => {
              const a1 = entry.team_a_player_1_id ? playerNameById.get(entry.team_a_player_1_id) ?? "?" : "?";
              const a2 = entry.team_a_player_2_id ? playerNameById.get(entry.team_a_player_2_id) ?? "?" : "?";
              const b1 = entry.team_b_player_1_id ? playerNameById.get(entry.team_b_player_1_id) ?? "?" : "?";
              const b2 = entry.team_b_player_2_id ? playerNameById.get(entry.team_b_player_2_id) ?? "?" : "?";
              const by = entry.performed_by ? playerNameById.get(entry.performed_by) ?? "Unknown admin" : "Unknown admin";
              return (
                <div key={entry.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                      {entry.action === "delete" ? "Deleted" : "Score corrected"}
                    </span>
                    <span className="stat-meta" style={{ marginTop: 0, flex: "0 0 auto" }}>
                      {new Date(entry.performed_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="stat-meta" style={{ marginTop: 2 }}>
                    {a1} & {a2} vs {b1} & {b2} · played{" "}
                    {new Date(entry.played_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </div>
                  <div className="stat-meta" style={{ marginTop: 2, color: "var(--text)" }}>
                    {entry.old_team_a_score}-{entry.old_team_b_score}
                    {entry.action === "edit_score"
                      ? ` → ${entry.new_team_a_score}-${entry.new_team_b_score}`
                      : " (deleted)"}{" "}
                    · by {by}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        title="Error logs"
        subtitle={errorLogsLoading ? undefined : errorLogs.length === 0 ? "No errors logged" : `${errorLogs.length} logged`}
      >
        <p className="stat-meta" style={{ marginTop: 0 }}>
          Uncaught errors from members' devices, logged automatically — useful for spotting real bugs (like a
          browser quirk on a specific phone) without relying on someone describing it after the fact.
        </p>
        {errorLogsLoading ? (
          <p className="stat-meta">Loading…</p>
        ) : errorLogs.length === 0 ? (
          <p className="stat-meta">No errors logged. Nothing's broken (that we know of).</p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {errorLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                  onClick={() => setExpandedLogId((id) => (id === log.id ? null : log.id))}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{log.message}</span>
                    <span className="stat-meta" style={{ marginTop: 0, flex: "0 0 auto" }}>
                      {new Date(log.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="stat-meta" style={{ marginTop: 2 }}>
                    {log.players?.display_name ?? "Unknown member"} · {log.source ?? "unknown source"}
                    {log.page_path && ` · ${log.page_path}`}
                  </div>
                  {expandedLogId === log.id && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: "0.75rem",
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: "var(--text-muted)",
                      }}
                    >
                      {log.stack ?? "No stack trace available."}
                      {log.user_agent && `\n\n${log.user_agent}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              disabled={clearingLogs}
              onClick={clearErrorLogs}
              style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
            >
              {clearingLogs ? "Clearing…" : "Clear all logs"}
            </button>
          </>
        )}
      </CollapsibleCard>

      <CollapsibleCard title="Add a placeholder player">
        <p className="stat-meta" style={{ marginTop: 0 }}>
          For members who haven't signed up yet — this adds them to the club with a "Guest" tag so you can still
          register them in matches and competitions. They can't sign in with this account; if they join for real
          later, they can sign up normally alongside it.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <input
            type="text"
            value={placeholderName}
            onChange={(e) => setPlaceholderName(e.target.value)}
            placeholder="Player's name"
            style={{ flex: "1 1 160px", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter") createPlaceholderPlayer();
            }}
          />
          <button
            disabled={creatingPlaceholder || !placeholderName.trim()}
            onClick={createPlaceholderPlayer}
            style={{ flex: "0 0 auto", width: "auto", marginTop: 0 }}
          >
            {creatingPlaceholder ? "Adding…" : "Add player"}
          </button>
        </div>
      </CollapsibleCard>

      <MemberList
        players={players}
        privateInfoByPlayer={privateInfoByPlayer}
        legacyBadges={legacyBadges}
        currentUserId={currentUserId}
        onSelectPlayer={onSelectPlayer}
        onReload={load}
        onReloadBadges={loadLegacyBadges}
        filter={(p) => p.is_admin}
        showSearch={false}
        sortAdminsFirst={false}
        listLabel="admin"
        emptyMessage="No admins yet."
      />
    </div>
  );
}
