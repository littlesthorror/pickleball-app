import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

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
    <App />
  </React.StrictMode>
);
