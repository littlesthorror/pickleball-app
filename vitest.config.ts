import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts (which loads the PWA plugin —
// unnecessary and potentially noisy for a plain test run). Picks up
// src/**/*.test.ts (badges.ts) and the Deno edge function's glicko2.test.ts
// — that file has no Deno-specific imports, so it runs fine under Node.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "supabase/functions/**/*.test.ts"],
  },
});
