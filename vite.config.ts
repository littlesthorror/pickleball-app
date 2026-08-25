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
      includeAssets: ["logo.png"],
      manifest: {
        name: "Sideline — Huntingdon Pickleball",
        short_name: "Sideline",
        description: "Club match ratings and leaderboard for Huntingdon Pickleball.",
        theme_color: "#0a1a33",
        background_color: "#f6f7fb",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/logo.png",
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
