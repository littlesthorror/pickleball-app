// Dashboard "hero" card for the next club event (2026-11-26, Ben's request —
// "implement the Hero card for Events"). Replaces the old thin "Next club
// event" row: the event, a spots-filled bar, the event-day weather, and a
// one-tap RSVP ("I'm in" / "Join waitlist" / "You're in") that uses the exact
// same event_rsvps rules as the full ticket popup on the Events page.
// Tapping anywhere else on the card opens Events for the full details
// (+1 guests, description, who's coming).

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { getEventForecast } from "../lib/weather";
import type { EventForecast } from "../lib/weather";
import type { EventRow } from "../types";

interface Props {
  event: EventRow;
  playerId: string;
  onViewEvents?: (eventId?: string) => void;
}

interface RsvpLite {
  player_id: string;
  status: "going" | "waitlist";
  plus_one: boolean;
}

export default function NextEventHero({ event, playerId, onViewEvents }: Props) {
  const [rsvps, setRsvps] = useState<RsvpLite[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<EventForecast | null>(null);

  async function loadRsvps() {
    const { data, error: err } = await supabase
      .from("event_rsvps")
      .select("player_id, status, plus_one")
      .eq("event_id", event.id);
    if (!err && data) {
      setRsvps(
        data.map((r) => ({
          player_id: r.player_id as string,
          status: r.status as "going" | "waitlist",
          plus_one: !!r.plus_one,
        }))
      );
    }
  }

  useEffect(() => {
    if (event.rsvp_enabled) loadRsvps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, event.rsvp_enabled]);

  useEffect(() => {
    if (!event.weather_enabled) return;
    let cancelled = false;
    getEventForecast(event.event_date, event.event_time).then((f) => {
      if (!cancelled) setForecast(f);
    });
    return () => {
      cancelled = true;
    };
  }, [event.event_date, event.event_time, event.weather_enabled]);

  const mine = rsvps?.find((r) => r.player_id === playerId) ?? null;
  const going = (rsvps ?? []).filter((r) => r.status === "going");
  // Headcount, not RSVP count — a +1 takes 2 spots (same accounting as the
  // Events ticket popup and promote_event_waitlist).
  const occupied = going.reduce((sum, r) => sum + (r.plus_one ? 2 : 1), 0);
  const capacity = event.capacity;
  const full = capacity != null && occupied >= capacity;
  const pct = capacity ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  const spotsLeft = capacity != null ? Math.max(0, capacity - occupied) : null;

  async function rsvp(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    setError(null);
    const wouldWaitlist = capacity != null && occupied + 1 > capacity;
    const { error: err } = await supabase.from("event_rsvps").insert({
      event_id: event.id,
      player_id: playerId,
      status: wouldWaitlist ? "waitlist" : "going",
      plus_one: false,
    });
    if (err) setError(err.message);
    else await loadRsvps();
    setSaving(false);
  }

  async function cancel(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("event_rsvps")
      .delete()
      .eq("event_id", event.id)
      .eq("player_id", playerId);
    if (err) setError(err.message);
    else await loadRsvps();
    setSaving(false);
  }

  const dateLabel = new Date(
    Number(event.event_date.slice(0, 4)),
    Number(event.event_date.slice(5, 7)) - 1,
    Number(event.event_date.slice(8, 10))
  ).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = event.event_time ? ` · ${event.event_time.slice(0, 5)}` : "";

  const muted = "rgba(255,255,255,0.72)";

  return (
    <div
      className="card"
      onClick={() => onViewEvents?.(event.id)}
      style={{
        background: "var(--navy-active)",
        color: "#fff",
        cursor: onViewEvents ? "pointer" : "default",
        border: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--orange-500)", fontWeight: 700, fontSize: "0.85rem" }}>Next club event</span>
        {/* Hidden when the event is today — the separate "Weather today"
            card right below already says the same thing. */}
        {forecast && event.event_date !== new Date().toISOString().slice(0, 10) && (
          <span
            style={{
              fontSize: "0.78rem",
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.14)",
              whiteSpace: "nowrap",
            }}
          >
            {forecast.emoji} {forecast.tempC}°C · {forecast.description}
          </span>
        )}
      </div>

      <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: 6, lineHeight: 1.2 }}>{event.title}</div>
      <div style={{ color: muted, fontSize: "0.9rem", marginTop: 2 }}>
        {dateLabel}
        {timeLabel}
        {event.location ? ` · ${event.location}` : ""}
      </div>
      {onViewEvents && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewEvents(event.id);
          }}
          style={{
            display: "inline-block",
            width: "auto",
            minHeight: 0,
            height: "auto",
            margin: "8px 0 0",
            padding: "4px 0",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.45)",
            borderRadius: 0,
            color: "rgba(255,255,255,0.9)",
            fontSize: "0.82rem",
            fontWeight: 600,
          }}
        >
          Event details →
        </button>
      )}

      {event.rsvp_enabled && capacity != null && (
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: full ? "#ff5a4f" : "var(--orange-500)",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginTop: 6, color: muted }}>
            <span>
              {occupied} of {capacity} spots filled
            </span>
            <span style={{ color: full ? "#ff9d96" : "var(--orange-500)", fontWeight: 700 }}>
              {full ? "Full" : `${spotsLeft} left`}
            </span>
          </div>
        </div>
      )}

      {event.rsvp_enabled && rsvps !== null && (
        <div style={{ marginTop: 14 }}>
          {mine ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700 }}>
                {mine.status === "going" ? "You're in ✓" : "You're on the waitlist"}
                {mine.plus_one ? " (+1 guest)" : ""}
              </span>
              <button
                disabled={saving}
                onClick={cancel}
                style={{
                  width: "auto",
                  minHeight: 0,
                  height: "auto",
                  margin: 0,
                  padding: "6px 14px",
                  fontSize: "0.8rem",
                  background: "transparent",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.45)",
                  borderRadius: 999,
                }}
              >
                {saving ? "…" : "Cancel"}
              </button>
            </div>
          ) : (
            <button
              disabled={saving || (full && !event.waitlist_enabled)}
              onClick={rsvp}
              style={{
                width: "100%",
                margin: 0,
                background: "var(--orange-500)",
                color: "#fff",
                border: "none",
                fontWeight: 800,
                fontSize: "1.05rem",
              }}
            >
              {saving ? "…" : full && event.waitlist_enabled ? "Join waitlist" : full ? "Fully booked" : "I'm in"}
            </button>
          )}
          {error && (
            <p style={{ color: "#ff9d96", fontSize: "0.8rem", margin: "8px 0 0" }}>{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
