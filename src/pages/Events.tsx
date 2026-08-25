import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "../supabaseClient";
import { useDraft } from "../lib/useDraft";
import { linkify } from "../lib/linkify";
import type { EventPosterPlaceholder, EventRow } from "../types";

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

// Themed fallback shown in place of a poster until one's been uploaded —
// picked by the admin from a dropdown (see the admin form below). Falls
// back further to a plain calendar icon for events created before this
// feature existed, which have no placeholder choice saved at all.
const PLACEHOLDER_STYLES: Record<EventPosterPlaceholder, { emoji: string; background: string }> = {
  trophy: { emoji: "🏆", background: "linear-gradient(160deg, var(--navy-900), var(--navy-700))" },
  social: { emoji: "🍷", background: "linear-gradient(160deg, var(--orange-600), var(--orange-500))" },
};

function posterVisual(
  e: EventRow
): { kind: "image"; url: string } | { kind: "placeholder"; emoji: string; background: string } {
  if (e.poster_path) return { kind: "image", url: posterUrl(e.poster_path) };
  const style = e.poster_placeholder ? PLACEHOLDER_STYLES[e.poster_placeholder] : null;
  return {
    kind: "placeholder",
    emoji: style?.emoji ?? "📅",
    background: style?.background ?? "linear-gradient(160deg, var(--navy-700), var(--navy-500))",
  };
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
                padding: "4px 0",
                borderRadius: 8,
                cursor: dayEvents ? "pointer" : "default",
                border: isSelected
                  ? "1.5px solid var(--orange-600)"
                  : isToday
                  ? "1px solid var(--navy-500)"
                  : "1px solid transparent",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  border: dayEvents ? "2px solid var(--orange-600)" : "2px solid transparent",
                  fontWeight: dayEvents || isToday || isSelected ? 700 : 400,
                }}
              >
                {day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact, legible list row used everywhere an event appears outside the
// ticket popup (Upcoming, Past, and the selected-calendar-day panel) —
// thumbnail + title + when + chevron, tap anywhere to open the full
// ticket. Admin Edit/Remove sit off to the side and stop the click from
// also opening the ticket.
function EventRowCard({
  event,
  isAdmin,
  compact,
  onOpen,
  onEdit,
  onDelete,
}: {
  event: EventRow;
  isAdmin: boolean;
  compact?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const visual = posterVisual(event);
  const size = compact ? 38 : 44;
  return (
    <div className="match-row" style={{ alignItems: "center" }}>
      <div className="event-row-card" onClick={onOpen} style={{ flex: 1, minWidth: 0 }}>
        <div
          className="event-row-thumb"
          style={{
            width: size,
            height: size,
            fontSize: compact ? 16 : 19,
            ...(visual.kind === "image"
              ? { backgroundImage: `url(${visual.url})` }
              : { background: visual.background }),
          }}
        >
          {visual.kind === "placeholder" && visual.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="opponent" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {event.title}
          </div>
          <div className="meta">
            {formatEventDate(event.event_date)}
            {formatEventTime(event.event_time) ? ` · ${formatEventTime(event.event_time)}` : ""}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
        <span style={{ color: "var(--text-muted)", fontSize: "1.1rem", flexShrink: 0 }}>›</span>
      </div>
      {isAdmin && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
          <span
            className="link-action"
            role="button"
            tabIndex={0}
            onClick={(ev) => {
              ev.stopPropagation();
              onEdit();
            }}
            style={{ fontSize: "0.72rem" }}
          >
            Edit
          </span>
          <span
            className="link-action"
            role="button"
            tabIndex={0}
            onClick={(ev) => {
              ev.stopPropagation();
              onDelete();
            }}
            style={{ fontSize: "0.72rem", color: "var(--danger)" }}
          >
            Remove
          </span>
        </div>
      )}
    </div>
  );
}

// The ticket-style detail popup — re-skinned from Ben's mockup
// (event-details-mockup.html, 2026-08-15) in the site's own navy/orange
// palette rather than the mockup's teal/lime one. Structure lifted as
// closely as possible: 16:9 poster, gradient header block, a perforated
// divider, a body with Format/Hosted-by rows, description, spots bar, and
// an RSVP button that becomes "Join waitlist" or a disabled "Fully
// booked" state.
function EventTicketModal({
  event,
  isAdmin,
  playerId,
  onClose,
  onZoom,
  onEdit,
  onDelete,
}: {
  event: EventRow;
  isAdmin: boolean;
  playerId: string;
  onClose: () => void;
  onZoom: (url: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Holds every RSVP row for this event (with the player's name joined
  // in) so both the counts and the "who's coming" list below can be
  // derived from one fetch — this is also how attendance actually gets
  // tracked: admins (or anyone, since RSVPs are readable by any signed-in
  // member) can open an event's ticket and see exactly who's said "I'm
  // in".
  interface RsvpRow {
    player_id: string;
    status: "going" | "waitlist";
    players: { display_name: string } | null;
  }
  const [rsvpRows, setRsvpRows] = useState<RsvpRow[] | null>(null);
  const [myStatus, setMyStatus] = useState<"going" | "waitlist" | null>(null);
  const [rsvpLoading, setRsvpLoading] = useState(true);
  const [rsvpSaving, setRsvpSaving] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);

  async function fetchRsvps() {
    setRsvpLoading(true);
    const { data, error } = await supabase
      .from("event_rsvps")
      .select("player_id, status, players(display_name)")
      .eq("event_id", event.id);
    if (!error && data) {
      const rows = data.map((r) => ({
        player_id: r.player_id as string,
        status: r.status as "going" | "waitlist",
        players: (r.players as unknown as { display_name: string } | null) ?? null,
      }));
      setRsvpRows(rows);
      const mine = rows.find((r) => r.player_id === playerId);
      setMyStatus(mine?.status ?? null);
    }
    setRsvpLoading(false);
  }

  useEffect(() => {
    if (!event.rsvp_enabled) {
      setRsvpLoading(false);
      return;
    }
    fetchRsvps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, event.rsvp_enabled, playerId]);

  const goingRows = rsvpRows?.filter((r) => r.status === "going") ?? [];
  const waitlistRows = rsvpRows?.filter((r) => r.status === "waitlist") ?? [];
  const goingCount = goingRows.length;
  const goingNames = goingRows
    .map((r) => r.players?.display_name ?? "Unknown")
    .sort((a, b) => a.localeCompare(b));
  const waitlistNames = waitlistRows
    .map((r) => r.players?.display_name ?? "Unknown")
    .sort((a, b) => a.localeCompare(b));

  async function handleRsvp() {
    setRsvpSaving(true);
    setRsvpError(null);
    const full = event.capacity != null && goingCount >= event.capacity;
    const status: "going" | "waitlist" = full ? "waitlist" : "going";
    const { error } = await supabase.from("event_rsvps").insert({ event_id: event.id, player_id: playerId, status });
    if (error) {
      setRsvpError(error.message);
    } else {
      await fetchRsvps();
    }
    setRsvpSaving(false);
  }

  async function handleCancelRsvp() {
    setRsvpSaving(true);
    setRsvpError(null);
    const { error } = await supabase
      .from("event_rsvps")
      .delete()
      .eq("event_id", event.id)
      .eq("player_id", playerId);
    if (error) {
      setRsvpError(error.message);
    } else {
      await fetchRsvps();
    }
    setRsvpSaving(false);
  }

  const visual = posterVisual(event);
  const spotsFull = event.capacity != null && goingCount >= event.capacity;
  const spotsPct = event.capacity ? Math.min(100, Math.round((goingCount / event.capacity) * 100)) : 0;

  return (
    <div className="ticket-overlay" onClick={onClose}>
      <div className="ticket-card" onClick={(ev) => ev.stopPropagation()}>
        <button className="ticket-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div
          className="ticket-poster"
          style={visual.kind === "image" ? { backgroundImage: `url(${visual.url})` } : { background: visual.background }}
          onClick={() => visual.kind === "image" && onZoom(visual.url)}
        >
          {visual.kind === "placeholder" && <span className="ticket-poster-icon">{visual.emoji}</span>}
          {visual.kind === "image" && <span className="ticket-poster-hint">Tap to zoom</span>}
        </div>

        <div className="ticket-header">
          {event.format && <div className="ticket-meta">{event.format}</div>}
          <h2 className="ticket-title">{event.title}</h2>
          <div className="ticket-when">
            📅 <strong>{formatEventDate(event.event_date)}</strong>
            {formatEventTime(event.event_time) ? ` · ${formatEventTime(event.event_time)}` : ""}
          </div>
          {event.location && <div className="ticket-when">📍 {event.location}</div>}
        </div>

        <div className="ticket-perforation">
          <span className="ticket-notch ticket-notch-left" />
          <span className="ticket-notch ticket-notch-right" />
        </div>

        <div className="ticket-body">
          {event.format && (
            <div className="ticket-row">
              <span className="ticket-row-label">Format</span>
              <span className="ticket-row-value">{event.format}</span>
            </div>
          )}
          {event.hosted_by && (
            <div className="ticket-row">
              <span className="ticket-row-label">Hosted by</span>
              <span className="ticket-row-value">{event.hosted_by}</span>
            </div>
          )}

          {event.description && (
            <p className="rich-text" style={{ marginTop: 16, marginBottom: 0 }}>
              {linkify(event.description)}
            </p>
          )}

          {event.rsvp_enabled && event.capacity != null && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 6 }}>
                <span className="stat-meta">Spots filled</span>
                <span className="stat-meta">{rsvpLoading ? "…" : `${goingCount} / ${event.capacity}`}</span>
              </div>
              <div className="ticket-spots-bar">
                <div className={`ticket-spots-fill${spotsFull ? " full" : ""}`} style={{ width: `${spotsPct}%` }} />
              </div>
            </div>
          )}

          {event.rsvp_enabled && !rsvpLoading && (goingNames.length > 0 || waitlistNames.length > 0) && (
            <div style={{ marginTop: 12 }}>
              {goingNames.length > 0 && (
                <p className="stat-meta" style={{ marginBottom: waitlistNames.length > 0 ? 4 : 0 }}>
                  <strong style={{ color: "var(--navy-700)" }}>
                    Going ({goingNames.length}):
                  </strong>{" "}
                  {goingNames.join(", ")}
                </p>
              )}
              {waitlistNames.length > 0 && (
                <p className="stat-meta" style={{ marginBottom: 0 }}>
                  <strong style={{ color: "var(--navy-700)" }}>
                    Waitlist ({waitlistNames.length}):
                  </strong>{" "}
                  {waitlistNames.join(", ")}
                </p>
              )}
            </div>
          )}

          {event.rsvp_enabled && rsvpError && (
            <p className="error" style={{ marginTop: 10 }}>
              {rsvpError}
            </p>
          )}

          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            {!event.rsvp_enabled ? null : myStatus ? (
              <>
                <p style={{ margin: 0, fontWeight: 600, color: "var(--navy-700)" }}>
                  {myStatus === "going" ? "You're in ✓" : "You're on the waitlist"}
                </p>
                <button
                  disabled={rsvpSaving}
                  onClick={handleCancelRsvp}
                  style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
                >
                  {rsvpSaving ? "…" : "Cancel"}
                </button>
              </>
            ) : event.capacity != null && spotsFull && !event.waitlist_enabled ? (
              <button disabled style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                Fully booked
              </button>
            ) : (
              <button disabled={rsvpLoading || rsvpSaving} onClick={handleRsvp}>
                {rsvpSaving ? "…" : spotsFull ? "Join waitlist" : "I'm in"}
              </button>
            )}

            {event.external_url && (
              <button className="btn-sky" onClick={() => window.open(event.external_url!, "_blank", "noopener,noreferrer")}>
                More info ↗
              </button>
            )}

            {isAdmin && (
              <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
                <span className="link-action" role="button" tabIndex={0} onClick={onEdit} style={{ fontSize: "0.78rem" }}>
                  Edit
                </span>
                <span
                  className="link-action"
                  role="button"
                  tabIndex={0}
                  onClick={onDelete}
                  style={{ fontSize: "0.78rem", color: "var(--danger)" }}
                >
                  Remove
                </span>
              </div>
            )}
          </div>
        </div>
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

const EVENTS_DRAFT_KEY = "sideline-draft-event";
const EMPTY_DRAFT = {
  showForm: "",
  editingId: "",
  title: "",
  description: "",
  eventDate: "",
  eventTime: "",
  location: "",
  format: "",
  hostedBy: "",
  externalUrl: "",
  capacity: "",
  waitlistEnabled: "",
  posterPlaceholder: "",
  // Defaults on, so existing behaviour (every event gets an "I'm in"
  // button) doesn't change unless an admin deliberately turns it off.
  rsvpEnabled: "1",
};

export default function Events({ isAdmin, playerId }: { isAdmin: boolean; playerId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft-persisted admin form fields — survives the Android "Choose a
  // file" tab reload and a backgrounded-tab discard on Safari/Chrome, same
  // fix as Notices and FAQ (see useDraft.ts). File objects can't be
  // persisted this way, so posterFile/existingPosterPath/removePoster are
  // kept as ordinary state below instead.
  const [draft, setDraft, clearDraft] = useDraft(EVENTS_DRAFT_KEY, EMPTY_DRAFT);
  const showForm = draft.showForm === "1";
  const editingId = draft.editingId || null;

  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [existingPosterPath, setExistingPosterPath] = useState<string | null>(null);
  const [removePoster, setRemovePoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [ticketEvent, setTicketEvent] = useState<EventRow | null>(null);

  // Category filter — "category" here is just whatever's been typed into
  // an event's Format field, so the options are built from whatever's
  // actually in use rather than a fixed list. Derived from the full,
  // unfiltered `events` so the dropdown doesn't lose options once one's
  // selected.
  const [categoryFilter, setCategoryFilter] = useState("");
  const categories = useMemo(
    () =>
      Array.from(new Set(events.map((e) => e.format).filter((f): f is string => !!f))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [events]
  );
  const filteredEvents = useMemo(
    () => (categoryFilter ? events.filter((e) => e.format === categoryFilter) : events),
    [events, categoryFilter]
  );

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
      if (e.key === "Escape") {
        setLightboxUrl(null);
        setTicketEvent(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // If a reload happens mid-edit (the whole point of the draft persisting
  // through it), existingPosterPath can't have survived — it's File-bucket
  // state, not draft state. Re-derive it from the matching event once the
  // list has loaded, same pattern as Notices.tsx's attachment restore.
  useEffect(() => {
    if (!editingId || events.length === 0) return;
    const ev = events.find((e) => e.id === editingId);
    if (ev) setExistingPosterPath(ev.poster_path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, events]);

  function closeForm() {
    clearDraft();
    setExistingPosterPath(null);
    setPosterFile(null);
    setRemovePoster(false);
    setSaveError(null);
  }

  function openCreateForm() {
    setDraft({ ...EMPTY_DRAFT, showForm: "1" });
    setExistingPosterPath(null);
    setPosterFile(null);
    setRemovePoster(false);
    setSaveError(null);
  }

  function openEditForm(e: EventRow) {
    setDraft({
      showForm: "1",
      editingId: e.id,
      title: e.title,
      description: e.description ?? "",
      eventDate: e.event_date,
      eventTime: e.event_time ?? "",
      location: e.location ?? "",
      format: e.format ?? "",
      hostedBy: e.hosted_by ?? "",
      externalUrl: e.external_url ?? "",
      capacity: e.capacity != null ? String(e.capacity) : "",
      waitlistEnabled: e.waitlist_enabled ? "1" : "",
      posterPlaceholder: e.poster_placeholder ?? "",
      rsvpEnabled: e.rsvp_enabled ? "1" : "",
    });
    setExistingPosterPath(e.poster_path);
    setPosterFile(null);
    setRemovePoster(false);
    setSaveError(null);
  }

  function handlePosterChange(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (file) {
      setPosterFile(file);
      setRemovePoster(false);
    }
  }

  async function handleSave() {
    if (!draft.title.trim() || !draft.eventDate) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      event_date: draft.eventDate,
      event_time: draft.eventTime || null,
      location: draft.location.trim() || null,
      format: draft.format.trim() || null,
      hosted_by: draft.hostedBy.trim() || null,
      external_url: draft.externalUrl.trim() || null,
      capacity: draft.capacity.trim() ? Number(draft.capacity) : null,
      waitlist_enabled: draft.waitlistEnabled === "1",
      poster_placeholder: (draft.posterPlaceholder || null) as EventPosterPlaceholder | null,
      rsvp_enabled: draft.rsvpEnabled === "1",
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
      // A fresh, unique path per upload — rather than always overwriting
      // events/<id>/poster.<ext> — so the image gets a new URL every time
      // a poster is replaced. The old scheme reused the same URL for every
      // replacement, so browsers kept showing the cached original even
      // though the file underneath had changed. Found and fixed 2026-08-14.
      const path = `events/${eventId}/poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("notices").upload(path, posterFile);
      if (uploadError) {
        setSaveError(`Event saved, but the poster failed to upload: ${uploadError.message}`);
        setSaving(false);
        load();
        return;
      }
      await supabase.from("events").update({ poster_path: path }).eq("id", eventId);
      // Clean up the old file now that the new one is safely in place —
      // otherwise every replacement leaves an orphaned image in storage.
      if (existingPosterPath && existingPosterPath !== path) {
        await supabase.storage.from("notices").remove([existingPosterPath]);
      }
    } else if (removePoster && eventId) {
      await supabase.from("events").update({ poster_path: null }).eq("id", eventId);
      if (existingPosterPath) {
        await supabase.storage.from("notices").remove([existingPosterPath]);
      }
    }

    closeForm();
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
  const visibleEvents = filteredEvents.filter((e) => now.getTime() - eventStart(e).getTime() < VISIBLE_WINDOW_MS);

  const upcoming = visibleEvents.filter((e) => {
    const [y, m, d] = e.event_date.split("-").map(Number);
    return new Date(y, m - 1, d) >= today;
  });
  const past = visibleEvents.filter((e) => !upcoming.includes(e));

  const hasRealPoster = (existingPosterPath && !removePoster) || !!posterFile;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 0 }}>Events</h1>
        {isAdmin && (
          <button
            style={{ marginTop: 0, width: "auto", padding: "8px 16px" }}
            onClick={() => (showForm ? closeForm() : openCreateForm())}
          >
            {showForm ? "Cancel" : "Add event"}
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <label>Filter by category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All events</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {isAdmin && showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <label style={{ marginTop: 0 }}>Title</label>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="e.g. Club dinner, Saturday round robin"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Date</label>
          <input
            type="date"
            value={draft.eventDate}
            onChange={(e) => setDraft((d) => ({ ...d, eventDate: e.target.value }))}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Time (optional)</label>
          <input
            type="time"
            value={draft.eventTime}
            onChange={(e) => setDraft((d) => ({ ...d, eventTime: e.target.value }))}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Location (optional)</label>
          <input
            type="text"
            value={draft.location}
            onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
            placeholder="e.g. The clubhouse"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>Format (optional)</label>
          <input
            type="text"
            list="event-format-options"
            value={draft.format}
            onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value }))}
            placeholder="e.g. Competition, Social, Trivia Night"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <datalist id="event-format-options">
            <option value="Competition" />
            <option value="Social" />
            <option value="Trivia Night" />
            <option value="Ladder" />
            <option value="Tournament" />
            <option value="Coaching" />
            <option value="Round Robin" />
          </datalist>

          <label>Hosted by (optional)</label>
          <input
            type="text"
            value={draft.hostedBy}
            onChange={(e) => setDraft((d) => ({ ...d, hostedBy: e.target.value }))}
            placeholder="e.g. Committee, Coach Sam"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label>External link (optional)</label>
          <input
            type="url"
            value={draft.externalUrl}
            onChange={(e) => setDraft((d) => ({ ...d, externalUrl: e.target.value }))}
            placeholder="e.g. a sign-up form or entry page"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={draft.rsvpEnabled === "1"}
              onChange={(e) => setDraft((d) => ({ ...d, rsvpEnabled: e.target.checked ? "1" : "" }))}
              style={{ width: "auto" }}
            />
            Show an "I'm in" RSVP button
          </label>
          <p className="stat-meta" style={{ marginTop: 2 }}>
            Turn this off for events where attendance isn't tracked (e.g. a general announcement).
          </p>

          {draft.rsvpEnabled === "1" && (
            <>
              <label>Capacity (optional)</label>
              <input
                type="number"
                min={1}
                value={draft.capacity}
                onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
                placeholder="Leave blank for no limit"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              />

              {draft.capacity.trim() && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={draft.waitlistEnabled === "1"}
                    onChange={(e) => setDraft((d) => ({ ...d, waitlistEnabled: e.target.checked ? "1" : "" }))}
                    style={{ width: "auto" }}
                  />
                  Allow a waitlist once full
                </label>
              )}
            </>
          )}

          <label>Description (optional)</label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
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
              <span className="link-action" role="button" tabIndex={0} onClick={() => setRemovePoster(true)}>
                Remove poster
              </span>
            </div>
          )}
          {posterFile && <p className="stat-meta" style={{ marginTop: 0 }}>Selected: {posterFile.name}</p>}
          <input type="file" accept="image/*" onChange={handlePosterChange} />

          {!hasRealPoster && (
            <>
              <label>Placeholder (until a poster's added)</label>
              <select
                value={draft.posterPlaceholder}
                onChange={(e) => setDraft((d) => ({ ...d, posterPlaceholder: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              >
                <option value="">No placeholder (plain calendar icon)</option>
                <option value="trophy">🏆 Trophy — competition</option>
                <option value="social">🍷 Wine glass — social</option>
              </select>
            </>
          )}

          {saveError && <p className="error">{saveError}</p>}

          <button disabled={saving || !draft.title.trim() || !draft.eventDate} onClick={handleSave}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create event"}
          </button>
        </div>
      )}

      <MonthCalendar events={filteredEvents} selectedDate={selectedDate} onSelectDate={(d) => setSelectedDate(d)} />

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
          {filteredEvents
            .filter((e) => e.event_date === selectedDate)
            .map((e) => (
              <EventRowCard
                key={e.id}
                event={e}
                isAdmin={isAdmin}
                onOpen={() => setTicketEvent(e)}
                onEdit={() => openEditForm(e)}
                onDelete={() => handleDelete(e.id)}
              />
            ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Upcoming</h2>
        {upcoming.length === 0 && <p className="stat-meta">No upcoming events yet.</p>}
        {upcoming.slice(0, visibleUpcoming).map((e) => (
          <EventRowCard
            key={e.id}
            event={e}
            isAdmin={isAdmin}
            onOpen={() => setTicketEvent(e)}
            onEdit={() => openEditForm(e)}
            onDelete={() => handleDelete(e.id)}
          />
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
            <EventRowCard
              key={e.id}
              event={e}
              isAdmin={isAdmin}
              compact
              onOpen={() => setTicketEvent(e)}
              onEdit={() => openEditForm(e)}
              onDelete={() => handleDelete(e.id)}
            />
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

      {ticketEvent && (
        <EventTicketModal
          event={ticketEvent}
          isAdmin={isAdmin}
          playerId={playerId}
          onClose={() => setTicketEvent(null)}
          onZoom={(url) => setLightboxUrl(url)}
          onEdit={() => {
            const e = ticketEvent;
            setTicketEvent(null);
            openEditForm(e);
          }}
          onDelete={() => {
            const id = ticketEvent.id;
            setTicketEvent(null);
            handleDelete(id);
          }}
        />
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
