// Supabase Edge Function — public iCalendar (.ics) feed of the club's PUBLIC
// events, for subscribing from Apple/Google/Outlook calendars. Deployed with
// verify_jwt = false because calendar apps can't sign in; access is gated by
// a secret token in the URL (club_settings.calendar_feed_token) instead.
//
// GET /functions/v1/calendar-feed?token=<token>[&download=1]
//
// Private ("save the date") events are excluded in the query itself
// (is_private = false), so they can never appear in the feed.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CAL_NAME = "Huntingdon Pickleball";
const TZID = "Europe/London";
const DEFAULT_DURATION_HOURS = 1; // events only store a start time
const PAST_DAYS_INCLUDED = 60;

const encoder = new TextEncoder();

// RFC 5545 text escaping.
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Fold a content line at 75 octets (continuation lines start with a space).
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // leading space counts toward the 75
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");

// "2026-11-05" -> "20261105"
const dateCompact = (d: string) => d.replace(/-/g, "");

// Adds days to a YYYY-MM-DD string, returns compact YYYYMMDD.
function addDaysCompact(d: string, days: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + days));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

// date + "HH:MM[:SS]" -> compact local date-time "YYYYMMDDTHHMMSS" plus an
// end time DEFAULT_DURATION_HOURS later (as local wall-clock time).
function localDateTime(date: string, time: string, plusHours = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map((x) => Number(x || 0));
  const dt = new Date(Date.UTC(y, m - 1, d, hh + plusHours, mm, ss || 0));
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}`
  );
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0100",
  "TZNAME:BST",
  "DTSTART:19700329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0000",
  "TZNAME:GMT",
  "DTSTART:19701025T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

// deno-lint-ignore no-explicit-any
function buildIcs(events: any[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sideline//Huntingdon Pickleball//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(CAL_NAME)}`,
    `X-WR-TIMEZONE:${TZID}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...VTIMEZONE,
  ];

  for (const e of events) {
    const descParts: string[] = [];
    if (e.description) descParts.push(e.description);
    if (e.format) descParts.push(`Format: ${e.format}`);
    if (e.hosted_by) descParts.push(`Hosted by: ${e.hosted_by}`);
    if (e.external_url) descParts.push(e.external_url);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@sideline`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.event_time) {
      lines.push(`DTSTART;TZID=${TZID}:${localDateTime(e.event_date, e.event_time)}`);
      lines.push(`DTEND;TZID=${TZID}:${localDateTime(e.event_date, e.event_time, DEFAULT_DURATION_HOURS)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateCompact(e.event_date)}`);
      lines.push(`DTEND;VALUE=DATE:${addDaysCompact(e.event_date, 1)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (descParts.length) lines.push(`DESCRIPTION:${esc(descParts.join("\n"))}`);
    if (e.external_url) lines.push(`URL:${e.external_url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const notFound = () => new Response("Not found", { status: 404 });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token) return notFound();

    const { data: settings } = await supabase.from("club_settings").select("calendar_feed_token").limit(1).maybeSingle();
    const expected = settings?.calendar_feed_token;
    if (!expected || token !== expected) return notFound();

    const cutoff = new Date(Date.now() - PAST_DAYS_INCLUDED * 86400000).toISOString().slice(0, 10);
    const { data: events, error } = await supabase
      .from("events")
      .select("id, title, description, event_date, event_time, location, format, hosted_by, external_url")
      .eq("is_private", false)
      .gte("event_date", cutoff)
      .order("event_date", { ascending: true });
    if (error) return new Response("Couldn't load events", { status: 500 });

    const headers: Record<string, string> = {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    };
    if (url.searchParams.get("download")) {
      headers["Content-Disposition"] = 'attachment; filename="huntingdon-pickleball.ics"';
    }
    return new Response(buildIcs(events ?? []), { status: 200, headers });
  } catch (_err) {
    return new Response("Error", { status: 500 });
  }
});
