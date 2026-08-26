import { supabase } from "../supabaseClient";

// Admin-visible error logging (2026-08-25). Catches uncaught JS errors and
// unhandled promise rejections anywhere in the app and writes them to
// client_error_logs, so admins can see real bugs from real members'
// devices (e.g. an Android-only Google-Drive-attachment failure) instead of
// relying on someone describing it accurately after the fact. Deliberately
// best-effort: a failure to log an error should never itself throw or
// surface anything to the member — see the empty .catch() below.

// De-duped per page load so a single repeating error (e.g. one firing
// inside a render loop) can't flood the table.
const seen = new Set<string>();
const MAX_LOGS_PER_LOAD = 20;
let loggedCount = 0;

export async function logError(message: string, stack: string | undefined, source: string) {
  if (loggedCount >= MAX_LOGS_PER_LOAD) return;
  const key = `${source}:${message}:${stack?.slice(0, 200) ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  loggedCount++;

  try {
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("client_error_logs").insert({
      player_id: auth?.user?.id ?? null,
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 4000) ?? null,
      source,
      page_path: window.location.pathname,
      user_agent: navigator.userAgent,
    });
  } catch {
    // Best-effort only — never let logging itself break the app.
  }
}

export function initErrorLogging() {
  window.addEventListener("error", (event) => {
    logError(event.message || "Unknown error", event.error?.stack, "window.onerror");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logError(message, stack, "unhandledrejection");
  });
}
