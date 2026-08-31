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
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm extends ConfirmOptions {
  message: string;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirmAsync = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending({ message, ...options });
    });
  }, []);

  useBodyScrollLock(!!pending);

  function handle(result: boolean) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setPending(null);
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
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={() => handle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`confirm-ok${pending.danger ? " confirm-ok-danger" : ""}`}
                onClick={() => handle(true)}
                autoFocus
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
