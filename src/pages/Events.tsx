import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
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

// Combines the date + optional time into a real Date object, local time —
// used both for sorting same-day events by time of day, and for working
// out when an event's 24-hour "still visible" window ends.
function eventStart(e: EventRow): Date {
  const [y, m, d] = e.event_date.split("-").map(Number);
  if (e.event_time) {
    const [h, min] = e.event_time.split(":").map(Number);
    return new Date(y, m - 1, d, h, min);
  }
  return new Date(y, m - 1, d);
}

// Events with no upload just reuse the existing "notices" storage bucket
// under an events/ prefix, rather than needing a whole new bucket — its
// RLS is already "admins can write, anyone can read", no path restriction.
function posterUrl(path: string) {
  const { data } = supabase.storage.from("notices").getPublicUrl(path);
  return data.publicUrl;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// Global month-view calendar — shows every event on the club calendar (not
// just the "still visible" ones the lists below show) with a dot on any
// day that has something on, so people can browse forward/back and see
// what's coming up without needing to page through the list.
function MonthCalendar({
  events,
  selectedDate,
  onSelectDate,
}: {
  events: EventRow[];
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
}) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events) {
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return map;
  }, [events]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = toDateStr(new Date());

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span
          className="link-action"
          role="button"
          tabIndex={0}
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          style={{ fontSize: "1.2rem", padding: "0 8px" }}
        >
          ‹
        </span>
        <h2 style={{ marginBottom: 0 }}>{viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
        <span
          className="link-action"
          role="button"
          tabIndex={0}
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          style={{ fontSize: "1.2rem", padding: "0 8px" }}
        >
          ›
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i} className="stat-meta" style={{ fontWeight: 700, padding: "4px 0" }}>
            {label}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEvents = eventsByDate.get(dateStr);
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          return (
            <div
              key={i}
              onClick={() => dayEvents && onSelectDate(dateStr)}
              style={{
                position: "relative",
                padding: "8px 0 10px",
                borderRadius: 8,
                cursor: dayEvents ? "pointer" : "default",
                border: isSelected
                  ? "1.5px solid var(--orange-600)"
                  : isToday
                  ? "1px solid var(--navy-500)"
                  : "1px solid transparent",
                fontWeight: isToday || isSelected ? 700 : 400,
              }}
            >
              {day}
              {dayEvents && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 2,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--orange-600)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// How many events to show per section before a "Show more" button appears
// — keeps the page from growing indefinitely as events pile up over time.
const PAGE_SIZE = 6;

// How long an event stays visible (in both Upcoming and Past) after it
// starts, before it's hidden from the app entirely. The row itself isn't
// deleted — it just stops being shown — so nothing is ever lost.
const VISIBLE_WINDOW_MS = 24 * 60 * 60 * 1000;

export default function Events({ isAdmin }: { isAdmin: boolean }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [location, setLocation] = useState("");
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [existingPosterPath, setExistingPosterPath] = useState<string | null>(null);
  const [removePoster, setRemovePoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Upcoming and Past are paginated separately, since they're really two
  // different lists shown in one place.
  const [visibleUpcoming, setVisibleUpcoming] = useState(PAGE_SIZE);
  const [visiblePast, setVisiblePast] = useState(PAGE_SIZE);

  function load() {
    setLoading(true);
    supabase
      .from("events")
      .select("*")
      // Sorts by date first, then by time of day within the same date —
      // previously two events on the same day could show in the wrong
      // order because only the date was used for sorting. Events with no
      // time set (treated as "all day") sort before timed ones.
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true, nullsFirst: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setEvents((data ?? []) as EventRow[]);
        setLoading(false);
        setVisibleUpcoming(PAGE_SIZE);
        setVisiblePast(PAGE_SIZE);
      });
  }

  useEffect(load, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxUrl(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setEventDate("");
    setEventTime("");
    setLocation("");
    setPosterFile(null);
    setExistingPosterPath(null);
    setRemovePoster(false);
    setSaveError(null);
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(e: EventRow) {
    setEditingId(e.id);
    setTitle(e.title);
    setDescription(e.description ?? "");
    setEventDate(e.event_date);
    setEventTime(e.event_time ?? "");
    setLocation(e.location ?? "");
    setExistingPosterPath(e.poster_path);
    setPosterFile(null);
    setRemovePoster(false);
    setSaveError(null);
    setShowForm(true);
  }

  function handlePosterChange(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (file) {
      setPosterFile(file);
      setRemovePoster(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !eventDate) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      event_date: eventDate,
      event_time: eventTime || null,
      location: location.trim() || null,
    };

    let eventId = editingId;

    if (editingId) {
      const { error } = await supabase.from("events").update(payload).eq("id", editingId);
      if (error) {
        setSaveError(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const { data: inserted, error } = await supabase
        .from("events")
        .insert({ ...payload, created_by: userData?.user?.id ?? null })
        .select("id")
        .single();
      if (error || !inserted) {
        setSaveError(error?.message ?? "Couldn't create the event.");
        setSaving(false);
        return;
      }
      eventId = inserted.id;
    }

    if (posterFile && eventId) {
      const ext = posterFile.name.split(".").pop() || "jpg";
      const path = `events/${eventId}/poster.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("notices")
        .upload(path, posterFile, { upsert: true });
      if (uploadError) {
        setSaveError(`Event saved, but the poster failed to upload: ${uploadError.message}`);
        setSaving(false);
        load();
        return;
      }
      await supabase.from("events").update({ poster_path: path }).eq("id", eventId);
    } else if (removePoster && eventId) {
      await supabase.from("events").update({ poster_path: null }).eq("id", eventId);
    }

    resetForm();
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

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Events more than 24 hours past their start time are hidden from the
  // app entirely — the row stays in the database (nothing is deleted),
  // it just doesn't show in either Upcoming or Past any more.
  const visibleEvents = events.filter((e) => now.getTime() - eventStart(e).getTime() < VISIBLE_WINDOW_MS);

  const upcoming = visibleEvents.filter((e) => {
    const [y, m, d] = e.event_date.split("-").map(Number);
    return new Date(y, m - 1, d) >= today;
  });
  const past = visibleEvents.filter((e) => !upcoming.includes(e));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 0 }}>Events</h1>
        {isAdmin && (
          <button
            style={{ marginTop: 0, width: "auto", padding: "8px 16px" }}
            onClick={() => (showForm ? setShowForm(false) : openCreateForm())}
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

          <label>Poster image (optional)</label>
          {existingPosterPath && !removePoster && !posterFile && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <img
                src={posterUrl(existingPosterPath)}
                alt=""
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
              />
              <span
                className="link-action"
                role="button"
                tabIndex={0}
                onClick={() => setRemovePoster(true)}
              >
                Remove poster
              </span>
            </div>
          )}
          {posterFile && (
            <p className="stat-meta" style={{ marginTop: 0 }}>Selected: {posterFile.name}</p>
          )}
          <input type="file" accept="image/*" onChange={handlePosterChange} />

          {saveError && <p className="error">{saveError}</p>}

          <button disabled={saving || !title.trim() || !eventDate} onClick={handleSave}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create event"}
          </button>
        </div>
      )}

      <MonthCalendar events={events} selectedDate={selectedDate} onSelectDate={(d) => setSelectedDate(d)} />

      {selectedDate && (
        <div className="card" style={{ marginTop: 16, border: "1.5px solid var(--orange-600)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <h2 style={{ marginBottom: 8 }}>{formatEventDate(selectedDate)}</h2>
            <span
              className="link-action"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedDate(null)}
              style={{ fontSize: "0.78rem" }}
            >
              Close
            </span>
          </div>
          {events
            .filter((e) => e.event_date === selectedDate)
            .map((e) => (
              <div className="match-row" key={e.id} style={{ alignItems: "flex-start" }}>
                {e.poster_path && (
                  <img
                    src={posterUrl(e.poster_path)}
                    alt=""
                    onClick={() => setLightboxUrl(posterUrl(e.poster_path!))}
                    style={{
                      width: 48,
                      height: 48,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginRight: 12,
                      cursor: "zoom-in",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div>
                  <div className="opponent">{e.title}</div>
                  <div className="meta">
                    {formatEventTime(e.event_time) ? formatEventTime(e.event_time) : "All day"}
                    {e.location ? ` · ${e.location}` : ""}
                  </div>
                  {e.description && (
                    <div className="meta" style={{ marginTop: 4 }}>
                      {e.description}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Upcoming</h2>
        {upcoming.length === 0 && <p className="stat-meta">No upcoming events yet.</p>}
        {upcoming.slice(0, visibleUpcoming).map((e) => (
          <div className="match-row" key={e.id} style={{ alignItems: "flex-start" }}>
            {e.poster_path && (
              <img
                src={posterUrl(e.poster_path)}
                alt=""
                onClick={() => setLightboxUrl(posterUrl(e.poster_path!))}
                style={{
                  width: 48,
                  height: 48,
                  objectFit: "cover",
                  borderRadius: 8,
                  marginRight: 12,
                  cursor: "zoom-in",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1 }}>
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
              <div style={{ display: "flex", gap: 6 }}>
                <span
                  className="link-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditForm(e)}
                  style={{ fontSize: "0.78rem" }}
                >
                  Edit
                </span>
                <span
                  className="link-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleDelete(e.id)}
                  style={{ fontSize: "0.78rem", color: "var(--danger)" }}
                >
                  Remove
                </span>
              </div>
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
              {e.poster_path && (
                <img
                  src={posterUrl(e.poster_path)}
                  alt=""
                  onClick={() => setLightboxUrl(posterUrl(e.poster_path!))}
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "cover",
                    borderRadius: 8,
                    marginRight: 12,
                    cursor: "zoom-in",
                    flexShrink: 0,
                  }}
                />
              )}
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

      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="" className="lightbox-image" onClick={(ev) => ev.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
