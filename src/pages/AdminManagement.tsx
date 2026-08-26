import { useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { PlayerStatus } from "../types";

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
export default function AdminManagement({ currentUserId }: { currentUserId: string }) {
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

  // Client-side error logs (2026-08-25) — see src/lib/errorLogging.ts.
  const [errorLogs, setErrorLogs] = useState<ClientErrorLog[]>([]);
  const [errorLogsLoading, setErrorLogsLoading] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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

  useEffect(load, []);
  useEffect(loadInviteCode, []);
  useEffect(loadErrorLogs, []);

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
        <div className="card" key={p.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Avatar name={p.display_name} url={p.avatar_url} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{p.display_name}</div>
              <div className="stat-meta" style={{ marginTop: 0 }}>
                {p.games_played} games played
                {!p.is_active && " · deactivated"}
                {p.is_admin && " · admin"}
                {p.role_title && ` · ${p.role_title}`}
              </div>
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

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {p.id !== currentUserId && (
              <button
                disabled={busyId === p.id}
                onClick={() => toggleAdmin(p)}
                style={{ flex: "1 1 140px", marginTop: 0 }}
              >
                {p.is_admin ? "Remove admin" : "Make admin"}
              </button>
            )}
            <button
              disabled={busyId === p.id}
              onClick={() => toggleActive(p)}
              style={{ flex: "1 1 140px", marginTop: 0, background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
            >
              {p.is_active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              disabled={busyId === p.id}
              onClick={() => resetHistory(p)}
              style={{ flex: "1 1 140px", marginTop: 0, background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
            >
              Reset history
            </button>
            {p.games_played === 0 && (
              <button
                disabled={busyId === p.id}
                onClick={() => deletePlayer(p)}
                style={{ flex: "1 1 140px", marginTop: 0, background: "var(--danger)" }}
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
