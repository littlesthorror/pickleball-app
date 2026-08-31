// Replaces the browser's native alert() with a small non-blocking toast —
// added 2026-08-31 alongside ConfirmDialog.tsx, same reasoning (see that
// file's comment). Most alert() calls in this app are just "something
// went wrong, here's why" messages, not things that need a click-to-dismiss
// modal — a toast that appears near the bottom of the screen and fades on
// its own fits the actual severity better and doesn't block the page.
//
// Usage: wrap the app once in <ToastProvider>, then anywhere below it:
//
//   const toast = useToast();
//   toast.error(`Couldn't update: ${error.message}`);
//   toast.success("Saved!");

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  variant: "error" | "success";
}

export interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextToastId = 1;

// Errors stay up longer than successes — someone reading a failure message
// (often with specifics they might need to act on) needs more than a couple
// of seconds, while a "Saved!" is fine to glance at and forget.
const ERROR_DURATION_MS = 6000;
const SUCCESS_DURATION_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: "error" | "success") => {
      const id = nextToastId++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), variant === "error" ? ERROR_DURATION_MS : SUCCESS_DURATION_MS);
    },
    [dismiss]
  );

  const api: ToastApi = {
    error: (message) => push(message, "error"),
    success: (message) => push(message, "success"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.variant}`} onClick={() => dismiss(t.id)}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
