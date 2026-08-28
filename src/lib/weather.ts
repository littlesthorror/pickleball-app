// Weather forecast for Events (2026-08-28) — Ben's request: "auto-pull the
// forecast for each event's date/time... switchable on/off at time of
// posting... should update regularly to be accurate". Uses Open-Meteo
// (open-meteo.com) since it's free, keyless, and has a generous no-signup
// rate limit — no server-side secret or edge function needed, the browser
// can call it directly.
//
// Fixed to the club's own courts (Huntingdon PE29 7DA, per Ben 2026-08-28)
// rather than trying to geocode each event's free-text Location field —
// that field is often vague ("the clubhouse") or just unset, so a single
// hardcoded venue is far more reliable than guessing coordinates from text.
const VENUE_LAT = 52.336893;
const VENUE_LON = -0.187342;

// Open-Meteo's free forecast only covers the next ~16 days — anything
// further out genuinely has no forecast yet, not just "we haven't fetched
// it", so callers should treat null as "not available yet" rather than an
// error.
const MAX_FORECAST_DAYS = 16;

export interface EventForecast {
  tempC: number;
  precipitationChance: number | null;
  emoji: string;
  description: string;
}

// WMO weather codes, as used by Open-Meteo's `weathercode` field —
// collapsed down to just the buckets worth showing an emoji/label for on a
// small event card.
function describeWeatherCode(code: number): { emoji: string; description: string } {
  if (code === 0) return { emoji: "☀️", description: "Clear sky" };
  if (code === 1) return { emoji: "🌤️", description: "Mostly clear" };
  if (code === 2) return { emoji: "⛅", description: "Partly cloudy" };
  if (code === 3) return { emoji: "☁️", description: "Overcast" };
  if (code === 45 || code === 48) return { emoji: "🌫️", description: "Foggy" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", description: "Drizzle" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", description: "Rain" };
  if (code >= 71 && code <= 77) return { emoji: "🌨️", description: "Snow" };
  if (code >= 80 && code <= 82) return { emoji: "🌦️", description: "Rain showers" };
  if (code >= 85 && code <= 86) return { emoji: "🌨️", description: "Snow showers" };
  if (code >= 95) return { emoji: "⛈️", description: "Thunderstorm" };
  return { emoji: "🌡️", description: "—" };
}

// Short in-memory cache (session-only, no persistence) keyed by
// "date|time" — keeps repeated renders of the same event (e.g. both the
// Upcoming list row and its ticket popup) from firing duplicate requests,
// without ever serving genuinely stale data across a fresh page load, which
// is exactly what "update regularly" needs: each new visit re-fetches from
// Open-Meteo rather than relying on anything long-lived.
const cache = new Map<string, { fetchedAt: number; value: EventForecast | null }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function getEventForecast(dateStr: string, timeStr: string | null): Promise<EventForecast | null> {
  const key = `${dateStr}|${timeStr ?? ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.value;

  const [y, m, d] = dateStr.split("-").map(Number);
  const eventDate = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysOut = Math.round((eventDate.getTime() - today.getTime()) / 86400000);

  if (daysOut < 0 || daysOut > MAX_FORECAST_DAYS) {
    cache.set(key, { fetchedAt: Date.now(), value: null });
    return null;
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${VENUE_LAT}&longitude=${VENUE_LON}` +
      `&hourly=temperature_2m,precipitation_probability,weathercode` +
      `&timezone=Europe%2FLondon&start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
    const data = await res.json();

    const times: string[] = data?.hourly?.time ?? [];
    const temps: number[] = data?.hourly?.temperature_2m ?? [];
    const codes: number[] = data?.hourly?.weathercode ?? [];
    const precip: number[] = data?.hourly?.precipitation_probability ?? [];
    if (times.length === 0) throw new Error("No forecast data returned");

    // Pick the hour closest to the event's start time — falls back to
    // midday (a reasonable representative reading) when no time was set.
    const targetHour = timeStr ? Number(timeStr.split(":")[0]) : 12;
    let bestIdx = 0;
    let bestDiff = Infinity;
    times.forEach((t, i) => {
      const hour = Number(t.slice(11, 13));
      const diff = Math.abs(hour - targetHour);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    });

    const { emoji, description } = describeWeatherCode(codes[bestIdx]);
    const value: EventForecast = {
      tempC: Math.round(temps[bestIdx]),
      precipitationChance: precip[bestIdx] ?? null,
      emoji,
      description,
    };
    cache.set(key, { fetchedAt: Date.now(), value });
    return value;
  } catch {
    // Network hiccup, rate limit, etc. — treat as "not available", never
    // block the rest of the event card on a weather failure.
    cache.set(key, { fetchedAt: Date.now(), value: null });
    return null;
  }
}
