// Replaces the browser's native confirm() with a styled in-app dialog
// matching the app's own look — added 2026-08-31 after a member described
// the app as "clunky". Native confirm()/alert() popups are unstyled system
// dialogs that look nothing like the rest of the app (no rounded corners,
// no brand colors), and on mobile in particular can read more like a
// security warning than a normal "are you sure?" prompt.
//
// Usage: wrap the app once in <ConfirmProvider>, then anywhere below it:
//
//   const confirm = useConfirm();
//   async function handleDelete() {
//     if (!(await confirm("Remove this notice?"))) return;
//     ...
//   }
//
// Deliberately promise-based so call sites read almost identically to the
// native confirm() calls they're replacing — `if (!confirm(...)) return;`
// becomes `if (!(await confirm(...))) return;`, keeping the diff small and
// the logic unchanged.

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Red confirm button instead of the usual orange — for actions that
  // delete or permanently change something, matching the danger styling
  // used elsewhere in the app (e.g. the Delete button on AdminManagement).
  danger?: boolean;
  // Requires typing this exact word into a text box before the confirm
  // button enables at all — an extra speed bump on top of `danger` for the
  // most permanent actions (2026-09-07, Ben's request, for deleting a
  // competition: "you have to type the word DELETE. For safety."). Case-
  // sensitive, exact match — no trimming, so " delete" or "Delete " won't
  // enable the button either.
  requireTypedConfirmation?: string;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm extends ConfirmOptions {
  message: string;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Only used when pending.requireTypedConfirmation is set — reset on
  // every open/close so a leftover "DELETE" from a previous dialog can't
  // silently pre-satisfy the next one.
  const [typedValue, setTypedValue] = useState("");
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirmAsync = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setTypedValue("");
      setPending({ message, ...options });
    });
  }, []);

  useBodyScrollLock(!!pending);

  function handle(result: boolean) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setPending(null);
    setTypedValue("");
  }

  return (
    <ConfirmContext.Provider value={confirmAsync}>
      {children}
      {pending && (
        <div
          className="confirm-overlay"
          role="presentation"
          onClick={() => handle(false)}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title ?? pending.message}
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title && <h3 className="confirm-title">{pending.title}</h3>}
            <p className="confirm-message">{pending.message}</p>
            {pending.requireTypedConfirmation && (
              <input
                type="text"
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                placeholder={`Type ${pending.requireTypedConfirmation} to confirm`}
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={{ marginTop: 14 }}
              />
            )}
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={() => handle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`confirm-ok${pending.danger ? " confirm-ok-danger" : ""}`}
                onClick={() => handle(true)}
                disabled={!!pending.requireTypedConfirmation && typedValue !== pending.requireTypedConfirmation}
                autoFocus={!pending.requireTypedConfirmation}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
