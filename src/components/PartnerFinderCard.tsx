// Partner-finder board (2026-08-28) — Ben's request: a lightweight
// "looking for a doubles partner Tuesday 6pm" open-invite board, without
// adding a whole new nav tab/page. Deliberately just a small card on the
// Dashboard (own profile only, same as the next-event card/Share card),
// with a "See all" modal for the full list rather than a dedicated route —
// see 0051_add_partner_requests.sql for the data model this sits on top of.
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "./Avatar";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import type { PartnerRequestInterestRow, PartnerRequestRow } from "../types";

const STALE_FLEXIBLE_DAYS = 14;

function isOpen(r: PartnerRequestRow, todayStr: string) {
  if (r.play_date) return r.play_date >= todayStr;
  const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
  return ageDays <= STALE_FLEXIBLE_DAYS;
}

function formatWhen(r: PartnerRequestRow) {
  if (!r.play_date && !r.play_time) return "Any time";
  const parts: string[] = [];
  if (r.play_date) {
    const d = new Date(
      Number(r.play_date.slice(0, 4)),
      Number(r.play_date.slice(5, 7)) - 1,
      Number(r.play_date.slice(8, 10))
    );
    parts.push(d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
  }
  if (r.play_time) parts.push(r.play_time);
  return parts.join(" · ");
}

export default function PartnerFinderCard({ playerId, playerName }: { playerId: string; playerName: string }) {
  const [requests, setRequests] = useState<PartnerRequestRow[]>([]);
  const [interests, setInterests] = useState<PartnerRequestInterestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [note, setNote] = useState("");
  const [playDate, setPlayDate] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useBodyScrollLock(showAll);

  async function load() {
    const { data: reqData } = await supabase
      .from("partner_requests")
      .select("*, players(display_name, avatar_url)")
      .order("created_at", { ascending: false });
    const todayStr = new Date().toISOString().slice(0, 10);
    const open = ((reqData ?? []) as PartnerRequestRow[]).filter((r) => isOpen(r, todayStr));
    setRequests(open);

    if (open.length > 0) {
      const { data: intData } = await supabase
        .from("partner_request_interests")
        .select("*, players(display_name)")
        .in(
          "request_id",
          open.map((r) => r.id)
        );
      setInterests((intData ?? []) as PartnerRequestInterestRow[]);
    } else {
      setInterests([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function postRequest() {
    if (!note.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("partner_requests").insert({
      player_id: playerId,
      note: note.trim(),
      play_date: playDate || null,
      play_time: playTime.trim() || null,
    });
    setPosting(false);
    if (error) {
      alert(`Couldn't post that: ${error.message}`);
      return;
    }
    setNote("");
    setPlayDate("");
    setPlayTime("");
    setShowForm(false);
    load();
  }

  async function cancelRequest(id: string) {
    setBusyId(id);
    await supabase.from("partner_requests").delete().eq("id", id);
    setBusyId(null);
    load();
  }

  async function joinRequest(r: PartnerRequestRow) {
    setBusyId(r.id);
    const { error } = await supabase.from("partner_request_interests").insert({
      request_id: r.id,
      player_id: playerId,
    });
    if (!error) {
      // Best-effort — a failed push here shouldn't block the join itself.
      supabase.functions
        .invoke("send-push", {
          body: {
            player_id: r.player_id,
            title: `${playerName} is up for a game!`,
            body: `They joined your partner request: "${r.note.slice(0, 80)}"`,
            url: "/",
          },
        })
        .catch(() => {});
    }
    setBusyId(null);
    load();
  }

  async function leaveRequest(r: PartnerRequestRow) {
    setBusyId(r.id);
    await supabase
      .from("partner_request_interests")
      .delete()
      .eq("request_id", r.id)
      .eq("player_id", playerId);
    setBusyId(null);
    load();
  }

  if (loading) return null;

  function interestsFor(requestId: string) {
    return interests.filter((i) => i.request_id === requestId);
  }

  function Row({ r }: { r: PartnerRequestRow }) {
    const mine = r.player_id === playerId;
    const rowInterests = interestsFor(r.id);
    const iAmIn = rowInterests.some((i) => i.player_id === playerId);
    return (
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          padding: "10px 0",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Avatar name={r.players?.display_name ?? "?"} url={r.players?.avatar_url} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{r.players?.display_name ?? "A member"}</div>
          <div style={{ fontSize: "0.85rem", margin: "2px 0" }}>{r.note}</div>
          <div className="stat-meta" style={{ margin: 0 }}>
            {formatWhen(r)}
            {rowInterests.length > 0 && ` · ${rowInterests.length} interested`}
          </div>
        </div>
        {mine ? (
          <button
            disabled={busyId === r.id}
            onClick={() => cancelRequest(r.id)}
            style={{
              background: "transparent",
              color: "var(--danger)",
              border: "1px solid var(--border)",
              padding: "6px 10px",
              fontSize: "0.8rem",
              flexShrink: 0,
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            disabled={busyId === r.id}
            onClick={() => (iAmIn ? leaveRequest(r) : joinRequest(r))}
            style={{
              background: iAmIn ? "var(--orange-100)" : "var(--navy-active)",
              color: iAmIn ? "var(--orange-600)" : "#fff",
              padding: "6px 10px",
              fontSize: "0.8rem",
              flexShrink: 0,
            }}
          >
            {iAmIn ? "I'm in ✓" : "I'm in"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>🎾 Looking for a game?</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)", padding: "6px 12px", fontSize: "0.85rem" }}
        >
          {showForm ? "Cancel" : "Post a request"}
        </button>
      </div>

      {showForm && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle, rgba(15,37,71,0.04))" }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Looking for a doubles partner, happy to play any level"
            rows={2}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: "0.9rem", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input
              type="date"
              value={playDate}
              onChange={(e) => setPlayDate(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.85rem" }}
            />
            <input
              type="text"
              value={playTime}
              onChange={(e) => setPlayTime(e.target.value)}
              placeholder="Time (optional), e.g. 6pm"
              style={{ flex: 1, minWidth: 120, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.85rem" }}
            />
          </div>
          <p className="stat-meta" style={{ marginTop: 6 }}>
            Leave the date blank if you're flexible — posts without a date drop off after {STALE_FLEXIBLE_DAYS} days.
          </p>
          <button disabled={posting || !note.trim()} onClick={postRequest} style={{ marginTop: 4 }}>
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      )}

      {requests.length === 0 && !showForm && (
        <p className="stat-meta" style={{ marginTop: 10 }}>
          No open requests right now — be the first to post one.
        </p>
      )}

      {requests.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {requests.slice(0, 2).map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </div>
      )}

      {requests.length > 2 && (
        <button
          onClick={() => setShowAll(true)}
          style={{ marginTop: 10, background: "transparent", color: "var(--navy-500)", border: "none", padding: 0, fontSize: "0.85rem", textDecoration: "underline", cursor: "pointer" }}
        >
          See all {requests.length} requests
        </button>
      )}

      {showAll && (
        <div className="ticket-overlay" onClick={() => setShowAll(false)}>
          <div className="card" style={{ maxWidth: 460, width: "100%", maxHeight: "80vh", overflowY: "auto", position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button className="ticket-close" onClick={() => setShowAll(false)} aria-label="Close">
              ×
            </button>
            <h2 style={{ marginTop: 0 }}>🎾 Looking for a game?</h2>
            {requests.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
