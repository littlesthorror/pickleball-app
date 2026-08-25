import { useEffect, useState } from "react";

// Persists a form's in-progress values (and whether it's even open) to
// sessionStorage on every change, and restores them on mount. Fixes text
// being lost when Android's "Choose file" hands off to an external app
// like Google Drive and the browser reloads the tab under memory pressure
// on return, and the same class of loss when a backgrounded tab gets
// discarded and reloaded after switching to another tab/app and back
// (seen on both Android Chrome and Safari). sessionStorage survives that
// kind of reload — it's tied to the tab's session, not the individual
// page load — unlike plain React state, which lives only in memory and is
// wiped the instant the page reloads. Added 2026-08-15 at Ben's request.
//
// Deliberately string-only fields: a chosen File can't be serialized (and
// wouldn't survive a real reload anyway, since the browser discards the
// in-memory blob it pointed to) — so a picked-but-not-yet-uploaded
// attachment still needs re-picking after a reload. The text surviving is
// what actually saves the re-typing.
export function useDraft<T extends Record<string, string>>(storageKey: string, initial: T) {
  const [draft, setDraft] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? { ...initial, ...(JSON.parse(raw) as Partial<T>) } : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // Storage full/unavailable — not worth surfacing an error for a
      // convenience feature.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, draft]);

  function clearDraft() {
    setDraft(initial);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  return [draft, setDraft, clearDraft] as const;
}
