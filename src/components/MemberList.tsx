// Shared member-management block (2026-09-24) — extracted out of
// AdminManagement.tsx, which had grown into "club settings + the entire
// member list" on one ever-lengthening page (Ben: "everything keeps
// getting pushed down"). This component now owns the actual per-member
// UI (search, name/role editing, promote/demote, deactivate, reset
// history, delete, legacy badges, emergency/medical info) and is reused
// by two separate pages:
//   - AdminManagement.tsx renders it filtered to admins only (a short
//     list, so no search bar needed there).
//   - PlayerList.tsx (new, admin-only tab) renders it filtered to
//     everyone else, with the search bar — this is the page an admin
//     reaches for to actually look someone up.
// Both pages fetch their own roster data (players/privateInfo/legacy
// badges) and pass it in as props, along with reload callbacks, so this
// component itself has no Supabase fetching of its own — just the
// filter/search/sort and the per-card actions.
import { useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import Avatar from "./Avatar";
import type { LegacyBadgeRow, PlayerPrivateInfo, PlayerStatus } from "../types";
import { useConfirm } from "./ConfirmDialog";
import { useToast } from "./Toast";
import { ShowMoreLess } from "./ShowMoreLess";

const PAGE_SIZE = 20;

export default function MemberList({
  players,
  privateInfoByPlayer,
  legacyBadges,
  currentUserId,
  onSelectPlayer,
  onReload,
  onReloadBadges,
  filter,
  showSearch = true,
  searchPlaceholder = "Search by name…",
  sortAdminsFirst = true,
  listLabel = "member",
  emptyMessage,
}: {
  players: PlayerStatus[];
  privateInfoByPlayer: Record<string, PlayerPrivateInfo>;
  legacyBadges: LegacyBadgeRow[];
  currentUserId: string;
  onSelectPlayer?: (id: string, name: string) => void;
  onReload: () => void;
  onReloadBadges: () => void;
  filter?: (p: PlayerStatus) => boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  sortAdminsFirst?: boolean;
  listLabel?: string;
  emptyMessage?: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Draft text for each player's name/role, keyed by player id — only
  // populated once someone starts editing, falling back to the player's
  // real value otherwise (so there's no need to re-seed these whenever
  // `players` refreshes, unlike the old load()-seeded version).
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);

  const [openLegacyFormId, setOpenLegacyFormId] = useState<string | null>(null);
  const [expandedMedicalId, setExpandedMedicalId] = useState<string | null>(null);
  const [legacyDraft, setLegacyDraft] = useState({
    emoji: "🏆",
    label: "",
    description: "",
    achievedAt: new Date().toISOString().slice(0, 10),
  });
  const [grantingBadge, setGrantingBadge] = useState(false);

  const filteredSorted = useMemo(() => {
    const base = filter ? players.filter(filter) : players;
    const q = search.trim().toLowerCase();
    const filtered = q ? base.filter((p) => p.display_name.toLowerCase().includes(q)) : base;
    return [...filtered].sort((a, b) => {
      if (sortAdminsFirst && a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [players, search, filter, sortAdminsFirst]);

  const visiblePlayers = filteredSorted.slice(0, visibleCount);
  const remaining = filteredSorted.length - visiblePlayers.length;

  function onSearchChange(value: string) {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  }

  async function saveName(player: PlayerStatus) {
    const value = (nameDrafts[player.id] ?? player.display_name).trim();
    if (!value) {
      toast.error("Name can't be empty.");
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
      toast.error(`Couldn't update name: ${error.message}`);
      return;
    }
    setEditingNameId(null);
    onReload();
  }

  function cancelEditName(player: PlayerStatus) {
    setNameDrafts((prev) => ({ ...prev, [player.id]: player.display_name }));
    setEditingNameId(null);
  }

  async function saveRole(player: PlayerStatus) {
    const value = (roleDrafts[player.id] ?? player.role_title ?? "").trim();
    setBusyId(player.id);
    const { error } = await supabase
      .from("players")
      .update({ role_title: value || null })
      .eq("id", player.id);
    setBusyId(null);
    if (error) {
      toast.error(`Couldn't update role: ${error.message}`);
      return;
    }
    onReload();
  }

  async function toggleAdmin(player: PlayerStatus) {
    setBusyId(player.id);
    const { error } = await supabase.from("players").update({ is_admin: !player.is_admin }).eq("id", player.id);
    setBusyId(null);
    if (error) {
      toast.error(`Couldn't update admin status: ${error.message}`);
      return;
    }
    onReload();
  }

  async function toggleActive(player: PlayerStatus) {
    setBusyId(player.id);
    const { error } = await supabase.from("players").update({ is_active: !player.is_active }).eq("id", player.id);
    setBusyId(null);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      return;
    }
    onReload();
  }

  async function resetHistory(player: PlayerStatus) {
    if (
      !(await confirm(
        `Reset ${player.display_name}'s rating back to a fresh start? Their own dashboard will only count games from this point forward — everyone else's match history against them stays exactly as it is.`,
        { danger: true }
      ))
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
      const justReset = !!recheck?.reset_at && new Date(recheck.reset_at).getTime() > Date.now() - 15000;
      if (justReset) {
        onReload();
        return;
      }
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        toast.error(body?.error ?? "Couldn't reset this player's history.");
      } else {
        toast.error("Couldn't reach the server to reset this player's history — check your connection and try again.");
      }
      return;
    }
    onReload();
  }

  async function deletePlayer(player: PlayerStatus) {
    if (!(await confirm(`Permanently delete ${player.display_name}'s account? This can't be undone.`, { danger: true }))) {
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
      toast.error(
        `Couldn't delete ${player.display_name} — they still have match history attached to their account. Use "Deactivate" instead to hide them from match entry without losing anyone's shared results.`
      );
      return;
    }
    onReload();
  }

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
      toast.error(`Couldn't grant this badge: ${error.message}`);
      return;
    }
    setLegacyDraft({ emoji: "🏆", label: "", description: "", achievedAt: new Date().toISOString().slice(0, 10) });
    setOpenLegacyFormId(null);
    onReloadBadges();
  }

  async function revokeLegacyBadge(badge: LegacyBadgeRow) {
    if (!(await confirm(`Remove the "${badge.label}" badge from this player?`, { danger: true }))) return;
    const { error } = await supabase.from("legacy_badges").delete().eq("id", badge.id);
    if (error) {
      toast.error(`Couldn't remove this badge: ${error.message}`);
      return;
    }
    onReloadBadges();
  }

  return (
    <>
      <div className="card">
        {showSearch && (
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ marginBottom: 0 }}
          />
        )}
        <p className="stat-meta" style={{ marginTop: showSearch ? undefined : 0 }}>
          {filteredSorted.length} {listLabel}
          {filteredSorted.length === 1 ? "" : "s"}
          {search && ` matching "${search}"`}
          {sortAdminsFirst && " · admins shown first"}
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
                  {p.is_placeholder && (
                    <span
                      title="Added by an admin — hasn't signed up themselves"
                      style={{
                        flexShrink: 0,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "var(--border)",
                        color: "var(--text-muted)",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                      }}
                    >
                      Guest
                    </span>
                  )}
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
                {[!p.is_active && "Deactivated", p.is_admin && "Admin", p.role_title].filter(Boolean).join(" · ")}
              </div>
              {(privateInfoByPlayer[p.id]?.emergency_contact_name || privateInfoByPlayer[p.id]?.emergency_contact_phone) && (
                <div className="stat-meta" style={{ marginTop: 2 }}>
                  🚨 Emergency contact: {privateInfoByPlayer[p.id]?.emergency_contact_name ?? "—"}
                  {privateInfoByPlayer[p.id]?.emergency_contact_phone ? ` · ${privateInfoByPlayer[p.id]?.emergency_contact_phone}` : ""}
                </div>
              )}
              {privateInfoByPlayer[p.id]?.medical_info && (
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
                      {privateInfoByPlayer[p.id]?.medical_info}
                    </div>
                  )}
                </div>
              )}
            </div>
            <span
              title={p.profile_visible ? "Visible on the leaderboard" : "Hidden from the leaderboard"}
              aria-label={p.profile_visible ? "Visible on the leaderboard" : "Hidden from the leaderboard"}
              style={{ flexShrink: 0, alignSelf: "flex-start", color: "var(--text-muted)", opacity: p.profile_visible ? 0.5 : 0.85 }}
            >
              {p.profile_visible ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 1 12s4 7 11 7a9.26 9.26 0 0 0 5.39-1.61M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </svg>
              )}
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={roleDrafts[p.id] ?? p.role_title ?? ""}
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
              disabled={busyId === p.id || (roleDrafts[p.id] ?? p.role_title ?? "") === (p.role_title ?? "")}
              onClick={() => saveRole(p)}
              style={{ flex: "0 0 auto", width: "auto", marginTop: 0, padding: "8px 14px", fontSize: "0.85rem" }}
            >
              Save
            </button>
          </div>

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
        <p className="stat-meta">{emptyMessage ?? (search ? `No ${listLabel}s match "${search}".` : `No ${listLabel}s yet.`)}</p>
      )}

      <ShowMoreLess
        hasMore={remaining > 0}
        expanded={visibleCount > PAGE_SIZE}
        moreCount={remaining}
        onShowMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
        onShowLess={() => setVisibleCount(PAGE_SIZE)}
      />
    </>
  );
}
