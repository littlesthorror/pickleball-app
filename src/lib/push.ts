import { supabase } from "../supabaseClient";

// Web push subscribe/unsubscribe (2026-08-25). See src/sw.ts for the
// service worker side (the "push" and "notificationclick" listeners that
// actually show the notification) and
// supabase/functions/send-push/index.ts for who sends these.

// pushManager.subscribe() needs the VAPID public key as a raw
// Uint8Array, but it's stored/shipped as a base64url string (same format
// web-push and the browser Push API both expect) — this is the standard
// conversion helper for that.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Whether THIS browser/device currently holds a live push subscription —
// doesn't tell you whether it's actually saved server-side (see
// subscribeToPush, which keeps the two in sync via upsert).
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(playerId: string): Promise<void> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error("Push notifications aren't configured for this deployment yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // TS's DOM lib types applicationServerKey as BufferSource with a
      // strict ArrayBuffer (not ArrayBufferLike) generic on Uint8Array as
      // of TS 5.5 — a real Uint8Array satisfies the runtime API fine, this
      // cast just satisfies the overly-strict type.
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned an incomplete push subscription.");
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      player_id: playerId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "player_id,endpoint" }
  );
  if (error) throw new Error(error.message);
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}
