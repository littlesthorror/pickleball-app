// Supabase Edge Function — "This week at Sideline" push, Sunday 9:30pm
// Europe/London time. Triggered every 15 minutes by the weekly-digest-tick
// pg_cron job (see 0048_add_weekly_digest_cron.sql), which just hits this
// URL blind — all the actual "is it really the right moment?" logic lives
// here, not in the cron expression, specifically so it stays correct
// across the UK's BST/GMT clock change without needing a migration twice
// a year. See that migration's comment for the full reasoning.
//
// Deployed with verify_jwt disabled — this is a webhook-style function
// with no end-user caller, same as send-push (triggered only by pg_net
// from inside the database). It doesn't take any meaningful input from
// the request at all (the body is empty from the cron job), so there's
// nothing for a stranger finding the URL to manipulate — worst case they
// can force an extra digest send, which the last_weekly_digest_sent_at
// guard already limits to once per calendar week regardless.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Reads the current Europe/London wall-clock time via Intl rather than
// trusting the server's own timezone (Deno's runtime clock is UTC) —
// Intl.DateTimeFormat with timeZone: "Europe/London" already accounts for
// BST/GMT correctly without any manual offset math.
function londonNow(): { weekday: string; hour: number; minute: number; dateKey: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { weekday, hour, minute, dateKey } = londonNow();

    // Target window: Sunday, 21:30–21:44 London time. The cron ticks every
    // 15 minutes on the hour/quarter-hour, so this 15-minute window always
    // contains exactly one tick.
    const inWindow = weekday === "Sun" && hour === 21 && minute >= 30 && minute < 45;
    if (!inWindow) {
      return new Response(JSON.stringify({ ok: true, skipped: "not the send window" }), { status: 200, headers: corsHeaders });
    }

    const { data: settings } = await supabase.from("club_settings").select("last_weekly_digest_sent_at").limit(1).single();
    const lastSent = settings?.last_weekly_digest_sent_at as string | null | undefined;
    if (lastSent) {
      const lastSentLondon = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(lastSent));
      const [d, m, y] = lastSentLondon.split("/");
      if (`${y}-${m}-${d}` === dateKey) {
        return new Response(JSON.stringify({ ok: true, skipped: "already sent today" }), { status: 200, headers: corsHeaders });
      }
    }

    // ── Gather content ─────────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekAheadDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayDate = new Date().toISOString().slice(0, 10);

    const [{ count: noticeCountRaw }, { data: upcomingEvents }, { data: leaders }] = await Promise.all([
      supabase.from("notices").select("id", { count: "exact", head: true }).gte("created_at", weekAgoIso),
      supabase
        .from("events")
        .select("title, event_date")
        .eq("is_private", false)
        .gte("event_date", todayDate)
        .lte("event_date", weekAheadDate)
        .order("event_date", { ascending: true }),
      supabase.from("leaderboard").select("id, display_name, rating").eq("is_active", true),
    ]);

    const noticeCount = noticeCountRaw ?? 0;
    const eventCount = upcomingEvents?.length ?? 0;

    // Biggest positive mover over the last 7 days — deliberately only ever
    // names an improvement, never a drop, matching this app's existing
    // "no gloating, nothing compares you unfavourably to anyone else"
    // convention (see badges.ts). Uses player_rating_as_of(), the same
    // function already powering the 30-day delta on the Rating history
    // card, just with a 7-day window here.
    let topMoverName: string | null = null;
    let topMoverDelta = 0;
    if (leaders && leaders.length > 0) {
      const deltas = await Promise.all(
        leaders.map(async (p) => {
          const { data: pastRating } = await supabase.rpc("player_rating_as_of", {
            p_player_id: p.id,
            p_as_of: weekAgoIso,
          });
          const delta = pastRating != null ? p.rating - (pastRating as number) : 0;
          return { name: p.display_name as string, delta };
        })
      );
      const best = deltas.reduce((a, b) => (b.delta > a.delta ? b : a), { name: "", delta: 0 });
      if (best.delta > 0) {
        topMoverName = best.name;
        topMoverDelta = Math.round(best.delta);
      }
    }

    // Nothing worth telling anyone this week — skip sending an empty
    // digest, but still record the attempt so we don't check again for
    // the rest of today.
    if (noticeCount === 0 && eventCount === 0 && !topMoverName) {
      await supabase.from("club_settings").update({ last_weekly_digest_sent_at: nowIso }).eq("id", true);
      return new Response(JSON.stringify({ ok: true, skipped: "nothing to report" }), { status: 200, headers: corsHeaders });
    }

    const parts: string[] = [];
    if (eventCount > 0) parts.push(`${eventCount} event${eventCount === 1 ? "" : "s"} coming up`);
    if (noticeCount > 0) parts.push(`${noticeCount} new notice${noticeCount === 1 ? "" : "s"}`);
    if (topMoverName) parts.push(`${topMoverName} climbed ${topMoverDelta} rating points`);

    const title = "This week at Sideline 🏓";
    const digestBody = parts.join(" · ");

    await supabase.functions.invoke("send-push", {
      body: { broadcast: true, title, body: digestBody, url: "/#dashboard" },
    });

    await supabase.from("club_settings").update({ last_weekly_digest_sent_at: nowIso }).eq("id", true);

    return new Response(JSON.stringify({ ok: true, sent: true, summary: digestBody }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
