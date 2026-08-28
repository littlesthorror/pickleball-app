// Supabase Edge Function — sends Web Push notifications. Three ways to
// call it:
//
//   1. { table: "notices" | "events", id }
//      Broadcasts to every subscribed member who has that category turned
//      on (players.notify_new_notices / notify_new_events). Called by the
//      send_push_on_notice_insert / send_push_on_event_insert triggers via
//      pg_net (see add_push_notification_triggers migration, 2026-08-25).
//
//   2. { player_id, title, body, url?, category? }
//      Sends a single custom message to one player's subscriptions. Used
//      by notify-post-match (badge-earned/rank-change). If `category` is
//      "badge_earned" or "rank_change", the player's own preference
//      (players.notify_badge_earned / notify_rank_change) is checked here
//      rather than trusting the caller to have already checked it — belt
//      and braces since this function is deployed with verify_jwt disabled
//      (see below).
//
//   3. { broadcast: true, title, body, url? }
//      Sends to every subscribed member, with no per-category preference
//      check — used by the weekly-digest cron job (2026-08-28). The
//      digest doesn't map onto any of the four granular toggles (new
//      events/notices, badge earned, rank change), so it's gated only on
//      "does this person have push notifications on at all" (i.e. having
//      a push_subscriptions row), same as the original all-or-nothing
//      toggle before the granular settings existed.
//
// Deployed with verify_jwt disabled, since it's a webhook/internal-style
// function with no direct end-user caller (matches the original
// 2026-08-25 deployment) — called only by DB triggers via pg_net and by
// other edge functions using the service role, never directly from the
// browser with a user JWT. As the safety net for that: the table-based
// path always re-fetches the referenced row by id itself (using its own
// service-role client) rather than trusting anything else in the POST
// body, so a stranger who finds this URL can at worst re-trigger a
// notification for a real, already-public notice/event, or (for the
// direct-message path) send an arbitrary-but-harmless push to one specific
// player's own device — not access or leak anything private.
//
// Requires two Edge Function secrets to actually send anything (Supabase
// Dashboard → Edge Functions → send-push → Secrets):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — see the client's
//   VITE_VAPID_PUBLIC_KEY for the matching public half.
// Optional: VAPID_SUBJECT (defaults below).

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@sidelinepickleball.co.uk";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushPayload {
  title: string;
  body: string;
  url: string;
}

async function buildPayload(table: string, id: string): Promise<PushPayload | null> {
  if (table === "notices") {
    const { data } = await supabase.from("notices").select("title, body").eq("id", id).single();
    if (!data) return null;
    return {
      title: `New notice: ${data.title}`,
      body: (data.body ?? "").slice(0, 140),
      // No real client-side router — "#notices" is read by App.tsx's
      // initial-tab state so a notification tap lands on the right tab
      // instead of always the dashboard. See App.tsx, 2026-08-25.
      url: "/#notices",
    };
  }

  if (table === "events") {
    const { data } = await supabase
      .from("events")
      .select("title, event_date, location")
      .eq("id", id)
      .single();
    if (!data) return null;
    const when = new Date(data.event_date).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return {
      title: `New event: ${data.title}`,
      body: [when, data.location].filter(Boolean).join(" · "),
      url: "/#events",
    };
  }

  return null;
}

interface Subscriber {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendToSubscribers(subs: Subscriber[], payload: PushPayload) {
  let sent = 0;
  const staleIds: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err) {
        // 404/410 means the browser/OS has invalidated this subscription
        // (uninstalled, permissions revoked, etc.) — clean it up so future
        // sends don't keep wasting time on it.
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  return { sent, removed: staleIds.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ ok: true, skipped: "VAPID keys not configured" }), { status: 200, headers: corsHeaders });
    }

    const body = await req.json();

    // ── Broadcast to everyone subscribed, no category check (digest) ─────
    if (body.broadcast === true) {
      const { title, body: msgBody, url } = body as { title: string; body: string; url?: string };
      if (!title || !msgBody) {
        return new Response(JSON.stringify({ error: "title and body are required" }), { status: 400, headers: corsHeaders });
      }
      const { data: subs, error: subsError } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth");
      if (subsError) {
        return new Response(JSON.stringify({ error: subsError.message }), { status: 500, headers: corsHeaders });
      }
      const result = await sendToSubscribers((subs ?? []) as Subscriber[], { title, body: msgBody, url: url ?? "/" });
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: corsHeaders });
    }

    // ── Direct single-player message (badges, rank changes) ──────────────
    if (body.player_id) {
      const { player_id, title, body: msgBody, url, category } = body as {
        player_id: string;
        title: string;
        body: string;
        url?: string;
        category?: "badge_earned" | "rank_change";
      };
      if (!title || !msgBody) {
        return new Response(JSON.stringify({ error: "title and body are required" }), { status: 400, headers: corsHeaders });
      }

      if (category) {
        const prefColumn = category === "badge_earned" ? "notify_badge_earned" : "notify_rank_change";
        const { data: playerRow } = await supabase.from("players").select(prefColumn).eq("id", player_id).single();
        if (!playerRow || !(playerRow as Record<string, boolean>)[prefColumn]) {
          return new Response(JSON.stringify({ ok: true, skipped: "player has this category turned off" }), { status: 200, headers: corsHeaders });
        }
      }

      const { data: subs, error: subsError } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("player_id", player_id);
      if (subsError) {
        return new Response(JSON.stringify({ error: subsError.message }), { status: 500, headers: corsHeaders });
      }

      const result = await sendToSubscribers((subs ?? []) as Subscriber[], { title, body: msgBody, url: url ?? "/" });
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: corsHeaders });
    }

    // ── Broadcast for a notice/event row ──────────────────────────────────
    const { table, id } = body;
    if ((table !== "notices" && table !== "events") || !id) {
      return new Response(JSON.stringify({ error: "invalid payload" }), { status: 400, headers: corsHeaders });
    }

    const payload = await buildPayload(table, id);
    if (!payload) {
      return new Response(JSON.stringify({ ok: true, skipped: "row not found" }), { status: 200, headers: corsHeaders });
    }

    // Category filter (2026-08-28) — only send to subscribers who still
    // want this category, joining through to their own players row.
    const prefColumn = table === "notices" ? "notify_new_notices" : "notify_new_events";
    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, players!inner(notify_new_notices, notify_new_events)")
      .eq(`players.${prefColumn}`, true);
    if (subsError) {
      return new Response(JSON.stringify({ error: subsError.message }), { status: 500, headers: corsHeaders });
    }

    const result = await sendToSubscribers((subs ?? []) as unknown as Subscriber[], payload);
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
