/// <reference lib="webworker" />
// Custom service worker source (2026-08-25), built by vite-plugin-pwa's
// "injectManifest" strategy (see vite.config.ts) instead of its default
// auto-generated "generateSW" one. Needed because the default strategy
// doesn't let us add our own "push"/"notificationclick" listeners — this
// file replaces it while keeping the same precaching behavior the app
// already relied on.
//
// Deliberately excluded from tsconfig.json's normal `src` type-check (see
// that file's `exclude`) since `self` here is a ServiceWorkerGlobalScope,
// not a Window — the app's tsconfig only has DOM lib types. vite-plugin-pwa
// bundles/transpiles this file separately at build time via esbuild, so
// that exclusion doesn't affect the actual build.

import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Injected at build time with the list of every hashed build asset — this
// is what makes the PWA actually work offline/cache-first, same as the
// previous auto-generated service worker did.
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; url?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Sideline", body: event.data.text() };
  }

  const title = payload.title ?? "Sideline";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      icon: "/logo.png",
      badge: "/logo.png",
      data: { url: payload.url ?? "/" },
    })
  );
});

// Focuses an already-open tab if one exists (navigating it to the right
// page), otherwise opens a new one — standard "handle a notification tap"
// pattern for PWAs.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) ?? "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(targetUrl);
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
