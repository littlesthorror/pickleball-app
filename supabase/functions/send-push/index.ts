// Supabase Edge Function — sends a Web Push notification to every
// subscribed member when a new notice or event is created. Only ever
// called internally by the `send_push_on_notice_insert` /
// `send_push_on_event_insert` triggers (see the
// add_push_notification_triggers migration, 2026-08-25), via pg_net.
//
// Deployed with verify_jwt disabled, since it's a webhook-style function
// with no end-user caller — see that migration's comment for the
// reasoning. As the safety net for that: this function always re-fetches
// the referenced row by id itself (using its own service-role client)
// rather than trusting anything else in the POST body, so a stranger who
// finds this URL can at worst re-trigger a notification for a real,
// already-public notice/event — not send arbitrary text to members.
//
// Requires two Edge Function secrets to actually send anything (set these
// in the Supabase Dashboard under Edge Functions → send-push → Secrets, or
// via `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — must match VITE_VAPID_PUBLIC_KEY in the client's
//                        env, otherwise browsers will reject subscriptions
//                        signed with a mismatched key.
//   VAPID_PRIVATE_KEY  — keep this one secret, server-side only.
// Optional:
//   VAPID_SUBJECT       — a mailto: or https: contact URL some push
//                        services want in the VAPID JWT. Defaults below.

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

Deno.serve(async (req) => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      // Not configured yet — no-op rather than error, so notice/event
      // creation itself never fails because push isn't set up.
      return new Response(JSON.stringify({ ok: true, skipped: "VAPID keys not configured" }), { status: 200 });
    }

    const { table, id } = await req.json();
    if ((table !== "notices" && table !== "events") || !id) {
      return new Response(JSON.stringify({ error: "invalid payload" }), { status: 400 });
    }

    const payload = await buildPayload(table, id);
    if (!payload) {
      return new Response(JSON.stringify({ ok: true, skipped: "row not found" }), { status: 200 });
    }

    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth");
    if (subsError) {
      return new Response(JSON.stringify({ error: subsError.message }), { status: 500 });
    }

    let sent = 0;
    let removed = 0;
    const staleIds: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload)
          );
          sent++;
        } catch (err) {
          // 404/410 means the browser/OS has invalidated this subscription
          // (uninstalled, permissions revoked, etc.) — clean it up so
          // future sends don't keep wasting time on it.
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            staleIds.push(sub.id);
            removed++;
          }
        }
      })
    );

    if (staleIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", staleIds);
    }

    return new Response(JSON.stringify({ ok: true, sent, removed }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
