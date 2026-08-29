import { useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { LegacyBadgeRow, PlayerStatus } from "../types";

const PAGE_SIZE = 20;
const ERROR_LOG_LIMIT = 50;

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

// Full admin-management screen — replaces the earlier "hardcoded admin
// emails" approach. Any existing admin can promote/demote other players,
// deactivate/reactivate accounts, soft-reset a player's rating history
// (their own view resets to a fresh start; everyone else's shared match
// data is untouched — see supabase/functions/reset-player), and delete a
// player outright, but only once they have zero games played (the delete
// button is hidden otherwise, and the database's foreign-key constraints
// are the real backstop if that's ever bypassed).
//
// Every registered player shows up here, not just admins — this is also
// where roles/deactivation/reset live for anyone. With ~200 club members
// potentially signed up, admins are pinned to the top (highest priority
// to find quickly), then everyone else alphabetically, with a search box
// and "show more" pagination so the list stays manageable.
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
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // Draft text for each player's role title, keyed by player id — lets
  // each card have its own editable field without a form per player.
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  // Which player's name is currently being edited (pencil-icon toggle,
  // added 2026-08-27 to replace the always-visible name input with a
  // cleaner "tap to edit" row per Ben's request — only one at a time).
  const [editingNameId, setEditingNameId] = useState<string | null>(null);

  // Client-side error logs (2026-08-25) — see src/lib/errorLogging.ts.
  const [errorLogs, setErrorLogs] = useState<ClientErrorLog[]>([]);
  const [errorLogsLoading, setErrorLogsLoading] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Legacy badges (2026-08-28) — the one manually-grantable badge, for
  // real achievements that predate this app's own records (see
  // legacy_badges migration). Fetched once for every player, then grouped
  // by player_id client-side rather than one query per card.
  const [legacyBadges, setLegacyBadges] = useState<LegacyBadgeRow[]>([]);
  const [openLegacyFormId, setOpenLegacyFormId] = useState<string | null>(null);
  // Which player's medical info is currently expanded (2026-08-28) — kept
  // collapsed behind a small tap-to-reveal pill by default, same idiom as
  // badge descriptions on the Dashboard, so a long entry never blows out
  // the card's height or looks messy when the list first loads.
  const [expandedMedicalId, setExpandedMedicalId] = useState<string | null>(null);
  const [legacyDraft, setLegacyDraft] = useState({
    emoji: "🏆",
    label: "",
    description: "",
    achievedAt: new Date().toISOString().slice(0, 10),
  });
  const [grantingBadge, setGrantingBadge] = useState(false);

  function load() {
    setLoading(true);
    supabase
      .from("player_status")
      .select("*")
      .order("display_name")
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          const rows = (data ?? []) as PlayerStatus[];
          setPlayers(rows);
          setRoleDrafts(Object.fromEntries(rows.map((p) => [p.id, p.role_title ?? ""])));
        }
        setLoading(false);
      });
  }

  function loadInviteCode() {
    supabase
      .from("club_settings")
      .select("invite_code, show_competitions_tab")
      .single()
      .then(({ data }) => {
        setInviteCode(data?.invite_code ?? null);
        setInviteCodeInput(data?.invite_code ?? "");
        setShowCompetitionsTab(!!data?.show_competitions_tab);
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
      alert(`Couldn't update: ${error.message}`);
      return;
    }
    setShowCompetitionsTab(next);
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
    if (!confirm(`Clear all ${errorLogs.length} logged error${errorLogs.length === 1 ? "" : "s"}?`)) return;
    setClearingLogs(true);
    const { error } = await supabase.from("client_error_logs").delete().not("id", "is", null);
    setClearingLogs(false);
    if (error) {
      alert(`Couldn't clear error logs: ${error.message}`);
      return;
    }
    loadErrorLogs();
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
  useEffect(loadLegacyBadges, []);

  async function grantLegacyBadge(player: PlayerStatus) {
    if (!legacyDraft.label.trim() || !legacyDraft.description.trim()) return;
    setGrantingBadge(true);
    const { error } = await supabase.from("legacy_badges").insert({
      player_id: player.id,
      emoji: legacyDraft.emoji.trim() || "🏆",
      label: legacyDraft.label.trim(),
      description: legacyDraft.description.trim(),
      achieved_at: legacyDraft.achievedAt,
      granted_by: currentUserId,
    });
    setGrantingBadge(false);
    if (error) {
      alert(`Couldn't grant this badge: ${error.message}`);
      return;
    }
    setLegacyDraft({ emoji: "🏆", label: "", description: "", achievedAt: new Date().toISOString().slice(0, 10) });
    setOpenLegacyFormId(null);
    loadLegacyBadges();
  }

  async function revokeLegacyBadge(badge: LegacyBadgeRow) {
    if (!confirm(`Remove the "${badge.label}" badge from this player?`)) return;
    const { error } = await supabase.from("legacy_badges").delete().eq("id", badge.id);
    if (error) {
      alert(`Couldn't remove this badge: ${error.message}`);
      return;
    }
    loadLegacyBadges();
  }

  // Admins first (highest priority to find quickly), then everyone else
  // alphabetically. Search filters by name before sorting/paginating.
  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? players.filter((p) => p.display_name.toLowerCase().includes(q)) : players;
    return [...filtered].sort((a, b) => {
      if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [players, search]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  const visiblePlayers = filteredSorted.slice(0, visibleCount);
  const remaining = filteredSorted.length - visiblePlayers.length;

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
      alert(`Couldn't save: ${error.message}`);
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

  // Lets an admin correct a member's display name (typo, name change,
  // maiden/married name, etc.) without them needing to do it themselves.
  // Added 2026-08-27. Only the name changes — this doesn't touch their
  // login/email, avatar, or any match history, which is all keyed off
  // their player id, not their name.
  async function saveName(player: PlayerStatus) {
    const value = (nameDrafts[player.id] ?? player.display_name).trim();
    if (!value) {
      alert("Name can't be empty.");
      return;
    }
    if (value === player.display_name) {
      setEditingNameId(null);
      return;
    }
    setBusyId(player.id);
    const { error } = await supabase.from("players").update({ display_name: value }).eq("id", player.id);
    setBusyId(null);
    if (error) {
      alert(`Couldn't update name: ${error.message}`);
      return;
    }
    setEditingNameId(null);
    load();
  }

  function cancelEditName(player: PlayerStatus) {
    setNameDrafts((prev) => ({ ...prev, [player.id]: player.display_name }));
    setEditingNameId(null);
  }

  async function saveRole(player: PlayerStatus) {
    const value = (roleDrafts[player.id] ?? "").trim();
    setBusyId(player.id);
    const { error } = await supabase
      .from("players")
      .update({ role_title: value || null })
      .eq("id", player.id);
    setBusyId(null);
    if (error) {
      alert(`Couldn't update role: ${error.message}`);
      return;
    }
    load();
  }

  async function toggleAdmin(player: PlayerStatus) {
    setBusyId(player.id);
    const { error } = await supabase
      .from("players")
      .update({ is_admin: !player.is_admin })
      .eq("id", player.id);
    setBusyId(null);
    if (error) {
      alert(`Couldn't update admin status: ${error.message}`);
      return;
    }
    load();
  }

  async function toggleActive(player: PlayerStatus) {
    setBusyId(player.id);
    const { error } = await supabase
      .from("players")
      .update({ is_active: !player.is_active })
      .eq("id", player.id);
    setBusyId(null);
    if (error) {
      alert(`Couldn't update: ${error.message}`);
      return;
    }
    load();
  }

  async function resetHistory(player: PlayerStatus) {
    if (
      !confirm(
        `Reset ${player.display_name}'s rating back to a fresh start? Their own dashboard will only count games from this point forward — everyone else's match history against them stays exactly as it is.`
      )
    ) {
      return;
    }
    setBusyId(player.id);
    const { error } = await supabase.functions.invoke("reset-player", {
      body: { player_id: player.id },
    });
    setBusyId(null);
    if (error) {
      // Same false-failure class as confirm/delete/edit-match — invoke()
      // can report a client-side error even when the reset actually went
      // through server-side. Recheck the DB before showing an alarming
      // message: if reset_at was just set, it worked.
      const { data: recheck } = await supabase
        .from("player_ratings")
        .select("reset_at")
        .eq("player_id", player.id)
        .maybeSingle();
      const justReset =
        !!recheck?.reset_at && new Date(recheck.reset_at).getTime() > Date.now() - 15000;
      if (justReset) {
        load();
        return;
      }
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        alert(body?.error ?? "Couldn't reset this player's history.");
      } else {
        alert("Couldn't reach the server to reset this player's history — check your connection and try again.");
      }
      return;
    }
    load();
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
      !confirm(
        "Recalculate every player's rating from the complete match history? This rebuilds everyone's rating from scratch based on every confirmed game, in order — useful as a sanity check, but not something you'd normally need to run."
      )
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
        alert("Done — every player's rating has been recalculated from the full match history.");
        load();
        return;
      }
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        alert(body?.error ?? "Couldn't recompute ratings.");
      } else {
        alert("Couldn't reach the server to recompute ratings — check your connection and try again.");
      }
      return;
    }
    alert("Done — every player's rating has been recalculated from the full match history.");
    load();
  }

  async function deletePlayer(player: PlayerStatus) {
    if (!confirm(`Permanently delete ${player.display_name}'s account? This can't be undone.`)) {
      return;
    }
    setBusyId(player.id);
    const { error } = await supabase.from("players").delete().eq("id", player.id);
    setBusyId(null);
    if (error) {
      // The database's foreign-key constraints are the real safety net —
      // a player with any match history simply can't be deleted, so this
      // just explains that in plain language rather than showing the raw
      // Postgres error.
      alert(
        `Couldn't delete ${player.display_name} — they still have match history attached to their account. Use "Deactivate" instead to hide them from match entry without losing anyone's shared results.`
      );
      return;
    }
    load();
  }

  if (loading) return <p>Loading players…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Manage admins</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Promote or demote admins, deactivate accounts, or reset a player's rating history.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Invite code</h2>
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
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Competitions tab</h2>
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
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ratings</h2>
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
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Error logs</h2>
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
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Members</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          style={{ marginBottom: 0 }}
        />
        <p className="stat-meta">
          {filteredSorted.length} member{filteredSorted.length === 1 ? "" : "s"}
          {search && ` matching "${search}"`} · admins shown first
        </p>
      </div>

      {visiblePlayers.map((p) => (
        <div className={`card${p.is_admin ? " card-admin" : ""}`} key={p.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span
              role={onSelectPlayer ? "button" : undefined}
              tabIndex={onSelectPlayer ? 0 : undefined}
              aria-label={onSelectPlayer ? `View ${p.display_name}'s profile` : undefined}
              onClick={() => onSelectPlayer?.(p.id, p.display_name)}
              style={{ cursor: onSelectPlayer ? "pointer" : undefined, flexShrink: 0 }}
            >
              <Avatar name={p.display_name} url={p.avatar_url} size={40} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingNameId === p.id ? (
                // Inline edit mode — replaces the old always-visible name
                // input row with a pencil-icon toggle (2026-08-27, per
                // Ben: "rather than another text bar, a pencil icon next
                // to the name" is neater). Enter saves, Escape cancels.
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    autoFocus
                    value={nameDrafts[p.id] ?? p.display_name}
                    onChange={(e) => setNameDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName(p);
                      if (e.key === "Escape") cancelEditName(p);
                    }}
                    placeholder="Display name"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: "0.9rem",
                      fontWeight: 700,
                    }}
                  />
                  <button
                    disabled={busyId === p.id || (nameDrafts[p.id] ?? p.display_name).trim() === ""}
                    onClick={() => saveName(p)}
                    aria-label="Save name"
                    style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "6px 10px", fontSize: "0.9rem" }}
                  >
                    ✓
                  </button>
                  <button
                    disabled={busyId === p.id}
                    onClick={() => cancelEditName(p)}
                    aria-label="Cancel editing name"
                    style={{
                      flex: "0 0 auto",
                      width: "auto",
                      marginTop: 0,
                      padding: "6px 10px",
                      fontSize: "0.9rem",
                      background: "transparent",
                      color: "var(--navy-500)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div
                    role={onSelectPlayer ? "button" : undefined}
                    tabIndex={onSelectPlayer ? 0 : undefined}
                    aria-label={onSelectPlayer ? `View ${p.display_name}'s profile` : undefined}
                    onClick={() => onSelectPlayer?.(p.id, p.display_name)}
                    style={{
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: onSelectPlayer ? "pointer" : undefined,
                    }}
                  >
                    {p.display_name}
                  </div>
                  <button
                    onClick={() => {
                      setNameDrafts((prev) => ({ ...prev, [p.id]: p.display_name }));
                      setEditingNameId(p.id);
                    }}
                    aria-label={`Edit ${p.display_name}'s name`}
                    style={{
                      flex: "0 0 auto",
                      width: "auto",
                      marginTop: 0,
                      padding: "2px 6px",
                      fontSize: "0.85rem",
                      lineHeight: 1,
                      background: "transparent",
                      color: "var(--text-muted)",
                      border: "none",
                    }}
                  >
                    ✏️
                  </button>
                </div>
              )}
              <div className="stat-meta" style={{ marginTop: 0 }}>
                {/* Games played removed from here 2026-08-28 (Ben: profile
                    was feeling busy) — still used elsewhere (e.g. gating
                    the Delete button below), just not shown in this line
                    any more. "Admin" capitalised per Ben's request. */}
                {[!p.is_active && "Deactivated", p.is_admin && "Admin", p.role_title]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {/* Emergency contact (2026-08-28) — set by the player themselves
                  in My Account, shown here since admins are the only people
                  who should ever see it. */}
              {(p.emergency_contact_name || p.emergency_contact_phone) && (
                <div className="stat-meta" style={{ marginTop: 2 }}>
                  🚨 Emergency contact: {p.emergency_contact_name ?? "—"}
                  {p.emergency_contact_phone ? ` · ${p.emergency_contact_phone}` : ""}
                </div>
              )}
              {/* Essential Medical Information (2026-08-28) — same
                  admin-only visibility as emergency contact above. Kept
                  behind a tap-to-reveal pill rather than always shown
                  inline, since a long entry would otherwise blow out the
                  card's height and look messy — the pill itself is always
                  visible (so admins can always see at a glance that info
                  is on file) even when collapsed. Reworked 2026-08-28 at
                  Ben's request. */}
              {p.medical_info && (
                <div style={{ marginTop: 6 }}>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedMedicalId((id) => (id === p.id ? null : p.id))}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: "var(--orange-100)",
                      color: "var(--orange-600)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ⚕️ Medical info on file {expandedMedicalId === p.id ? "▲" : "▼"}
                  </span>
                  {expandedMedicalId === p.id && (
                    <div
                      style={{
                        marginTop: 4,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: "var(--orange-100)",
                        color: "var(--orange-600)",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        maxWidth: 420,
                      }}
                    >
                      {p.medical_info}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={roleDrafts[p.id] ?? ""}
              onChange={(e) => setRoleDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
              placeholder="Role (optional) — e.g. Club Coach"
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                fontSize: "0.85rem",
              }}
            />
            <button
              disabled={busyId === p.id || (roleDrafts[p.id] ?? "") === (p.role_title ?? "")}
              onClick={() => saveRole(p)}
              style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "8px 14px", fontSize: "0.85rem" }}
            >
              Save
            </button>
          </div>

          {/* Legacy badges (2026-08-28) — manual grant for achievements that
              predate this app's own records, e.g. an old competition run
              before Competitions existed in-app. See legacy_badges
              migration for why every other badge is computed, not granted. */}
          <div style={{ marginBottom: 12 }}>
            {legacyBadges.filter((b) => b.player_id === p.id).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {legacyBadges
                  .filter((b) => b.player_id === p.id)
                  .map((b) => (
                    <span
                      key={b.id}
                      title={b.description}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        fontSize: "0.78rem",
                      }}
                    >
                      {b.emoji} {b.label}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove ${b.label} badge`}
                        onClick={() => revokeLegacyBadge(b)}
                        style={{ cursor: "pointer", color: "var(--text-muted)", marginLeft: 2 }}
                      >
                        ✕
                      </span>
                    </span>
                  ))}
              </div>
            )}
            {openLegacyFormId === p.id ? (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    value={legacyDraft.emoji}
                    onChange={(e) => setLegacyDraft((d) => ({ ...d, emoji: e.target.value }))}
                    placeholder="🏆"
                    style={{ width: 56, flex: "0 0 auto", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", textAlign: "center" }}
                  />
                  <input
                    type="text"
                    value={legacyDraft.label}
                    onChange={(e) => setLegacyDraft((d) => ({ ...d, label: e.target.value }))}
                    placeholder="Badge name — e.g. 2024 Summer Champion"
                    style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </div>
                <textarea
                  value={legacyDraft.description}
                  onChange={(e) => setLegacyDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Description shown on their Dashboard — e.g. Won the 2024 Summer Doubles Championship."
                  rows={2}
                  style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "inherit", marginBottom: 8, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    value={legacyDraft.achievedAt}
                    onChange={(e) => setLegacyDraft((d) => ({ ...d, achievedAt: e.target.value }))}
                    style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                  <button
                    disabled={grantingBadge || !legacyDraft.label.trim() || !legacyDraft.description.trim()}
                    onClick={() => grantLegacyBadge(p)}
                    style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "6px 12px", fontSize: "0.85rem" }}
                  >
                    {grantingBadge ? "Granting…" : "Grant badge"}
                  </button>
                  <button
                    onClick={() => setOpenLegacyFormId(null)}
                    style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "6px 12px", fontSize: "0.85rem", background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <span
                className="link-action"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setLegacyDraft({ emoji: "🏆", label: "", description: "", achievedAt: new Date().toISOString().slice(0, 10) });
                  setOpenLegacyFormId(p.id);
                }}
                style={{ fontSize: "0.78rem" }}
              >
                🏅 Grant legacy badge
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {p.id !== currentUserId && (
              <button
                disabled={busyId === p.id}
                onClick={() => toggleAdmin(p)}
                style={{ flex: "1 1 140px", marginTop: 0, padding: "8px", fontSize: "0.85rem" }}
              >
                {p.is_admin ? "Remove admin" : "Make admin"}
              </button>
            )}
            <button
              disabled={busyId === p.id}
              onClick={() => toggleActive(p)}
              style={{ flex: "1 1 140px", marginTop: 0, padding: "8px", fontSize: "0.85rem", background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
            >
              {p.is_active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              disabled={busyId === p.id}
              onClick={() => resetHistory(p)}
              style={{ flex: "1 1 140px", marginTop: 0, padding: "8px", fontSize: "0.85rem", background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
            >
              Reset history
            </button>
            {p.games_played === 0 && (
              <button
                disabled={busyId === p.id}
                onClick={() => deletePlayer(p)}
                style={{ flex: "1 1 140px", marginTop: 0, padding: "8px", fontSize: "0.85rem", background: "var(--danger)" }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      {filteredSorted.length === 0 && (
        <p className="stat-meta">No members match "{search}".</p>
      )}

      {remaining > 0 && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
        >
          Show more ({remaining} more)
        </button>
      )}
    </div>
  );
}
