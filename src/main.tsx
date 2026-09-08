import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import PublicScoreboard from "./pages/PublicScoreboard";
import { initErrorLogging } from "./lib/errorLogging";
import "./index.css";

// Public, no-login live scoreboard route (2026-09-08, Ben's request) —
// checked before <App> ever mounts, so a spectator scanning a QR code at
// the courts never touches the normal signed-in shell (no auth listener,
// no session check, no nav). Deliberately a hash route ("#scoreboard/...")
// rather than a real URL path — a hash never reaches the server, so this
// works with zero server/CDN routing config, the same reason every other
// deep link in this app (e.g. "#notices") is hash-based. See
// src/pages/PublicScoreboard.tsx for the page itself.
const scoreboardMatch = window.location.hash.match(/^#scoreboard\/(.+)$/);

// Admin-visible error logging (2026-08-25) — see src/lib/errorLogging.ts.
initErrorLogging();

// The PWA plugin's default auto-injected registration script only checks
// for a new build when the browser happens to re-fetch the service worker
// (broadly: on a full navigation/reload) — fine for a normal website, but
// a club member who adds this to their home screen and just leaves it
// running in the background can go a long time without that ever
// happening, silently stuck on an old build even though the real fix has
// long since been deployed. Found 2026-08-25 investigating why the
// Notices/Events "new" dot never seemed to clear for anyone — the feature
// itself was correct, people were just running stale cached JS.
//
// This explicitly re-checks for an update whenever the app becomes
// visible again (covers reopening from the home screen / switching back
// to the tab) and hourly as a backstop, then reloads once a new version
// actually takes over — so a deployed fix reaches people within, at
// worst, one open-the-app cycle rather than indefinitely.
let refreshing = false;
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (refreshing) return;
  refreshing = true;
  window.location.reload();
});

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => registration.update();
    setInterval(checkForUpdate, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {scoreboardMatch ? <PublicScoreboard token={decodeURIComponent(scoreboardMatch[1])} /> : <App />}
  </React.StrictMode>
);
