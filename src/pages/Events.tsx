import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { EventRow } from "../types";

function formatEventDate(dateStr: string) {
  // event_date is a plain date (no time zone) — parse as local, not UTC,
  // so it doesn't shift a day depending on the viewer's time zone.
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatEventTime(timeStr: string | null) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// How many events to show per section before a "Show more" button appears
// — keeps the page from growing indefinitely as events pile up over time.
const PAGE_SIZE = 6;

export default function Events({ isAdmin }: { isAdmin: boolean }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Upcoming and Past are paginated separately, since they're really two
  // different lists shown in one place.
  const [visibleUpcoming, setVisibleUpcoming] = useState(PAGE_SIZE);
  const [visiblePast, setVisiblePast] = useState(PAGE_SIZE);

  function load() {
    setLoading(true);
    supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setEvents((data ?? []) as EventRow[]);
        setLoading(false);
        setVisibleUpcoming(PAGE_SIZE);
        setVisiblePast(PAGE_SIZE);
      });
  }

  useEffect(load, []);

  async function handleCreate() {
    if (!title.trim() || !eventDate) return;
    setSaving(true);
    setSaveError(null);

    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase.from("events").insert({
      title: title.trim(),
      description: description.trim() || null,
      event_date: eventDate,
      event_time: eventTime || null,
      location: location.trim() || null,
      created_by: userData?.user?.id ?? null,
    });

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    setTitle("");
    setDescription("");
    setEventDate("");
    setEventTime("");
    setLocation("");
    setShowForm(false);
    setSaving(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this event?")) return;
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    load();
  }

  if (loading) return <p>Loading events…</p>;
  if (error) return <p className="error">{error}</p>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = events.filter((e) => {
    const [y, m, d] = e.event_date.split("-").map(Number);
    return new Date(y, m - 1, d) >= today;
  });
  const past = events.filter((e) => !upcoming.includes(e));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 0 }}>Events</h1>
        {isAdmin && (
          <button
            style={{ marginTop: 0, width: "auto", padding: "8px 16px" }}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Add event"}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <label style={{ marginTop: 0 }}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Club dinner, Saturday round robin"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Date</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Time (optional)</label>
          <input
            type="time"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Location (optional)</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. The clubhouse"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              fontFamily: "inherit",
              fontSize: "1rem",
              resize: "vertical",
            }}
          />

          {saveError && <p className="error">{saveError}</p>}

          <button disabled={saving || !title.trim() || !eventDate} onClick={handleCreate}>
            {saving ? "Saving…" : "Create event"}
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Upcoming</h2>
        {upcoming.length === 0 && <p className="stat-meta">No upcoming events yet.</p>}
        {upcoming.slice(0, visibleUpcoming).map((e) => (
          <div className="match-row" key={e.id} style={{ alignItems: "flex-start" }}>
            <div>
              <div className="opponent">{e.title}</div>
              <div className="meta">
                {formatEventDate(e.event_date)}
                {formatEventTime(e.event_time) ? ` · ${formatEventTime(e.event_time)}` : ""}
                {e.location ? ` · ${e.location}` : ""}
              </div>
              {e.description && (
                <div className="meta" style={{ marginTop: 4 }}>
                  {e.description}
                </div>
              )}
            </div>
            {isAdmin && (
              <button
                onClick={() => handleDelete(e.id)}
                style={{
                  marginTop: 0,
                  width: "auto",
                  background: "transparent",
                  color: "var(--danger)",
                  padding: "4px 8px",
                  fontSize: "0.78rem",
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {upcoming.length > visibleUpcoming && (
          <button
            onClick={() => setVisibleUpcoming((c) => c + PAGE_SIZE)}
            style={{
              marginTop: 12,
              background: "transparent",
              color: "var(--navy-500)",
              border: "1px solid var(--border)",
            }}
          >
            Show more ({upcoming.length - visibleUpcoming} more)
          </button>
        )}
      </div>

      {past.length > 0 && (
        <div className="card">
          <h2>Past</h2>
          {past.slice(0, visiblePast).map((e) => (
            <div className="match-row" key={e.id}>
              <div>
                <div className="opponent">{e.title}</div>
                <div className="meta">{formatEventDate(e.event_date)}</div>
              </div>
            </div>
          ))}
          {past.length > visiblePast && (
            <button
              onClick={() => setVisiblePast((c) => c + PAGE_SIZE)}
              style={{
                marginTop: 12,
                background: "transparent",
                color: "var(--navy-500)",
                border: "1px solid var(--border)",
              }}
            >
              Show more ({past.length - visiblePast} more)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
