import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Switched from the default "generateSW" strategy to "injectManifest"
      // (2026-08-25) so the service worker can have custom "push" and
      // "notificationclick" listeners for web push notifications — see
      // src/sw.ts. injectManifest still auto-generates the precache
      // manifest (self.__WB_MANIFEST in sw.ts), it just lets us own the
      // rest of the file instead of having it fully generated.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // sw.ts is tiny; no need to precache-bust on every unrelated
        // dependency version bump.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp}"],
      },
      registerType: "autoUpdate",
      includeAssets: ["logo.png", "logo-192.png"],
      manifest: {
        name: "Sideline — Huntingdon Pickleball",
        short_name: "Sideline",
        description: "Club match ratings and leaderboard for Huntingdon Pickleball.",
        theme_color: "#0a1a33",
        background_color: "#f6f7fb",
        display: "standalone",
        start_url: "/",
        // The 192x192 entry used to point at logo.png (which is actually
        // 512x512) — Chrome's installability check decodes each icon and
        // can silently reject an entry whose real pixel size doesn't match
        // its declared "sizes", so a mismatched icon is a real (if
        // inconsistent-across-browsers/versions) reason the install prompt
        // can fail to appear for some users. logo-192.png (2026-08-27) is a
        // genuine 192x192 resize, so both entries now match their file.
        icons: [
          {
            src: "/logo-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/logo.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
