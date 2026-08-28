import { useEffect } from "react";

// Fixes a real mobile bug reported 2026-08-28: opening a full-screen
// overlay (the Events ticket popup, an image lightbox, the share card,
// etc.) while scrolled partway down a long page could make the overlay
// appear to render "at the top of the screen", forcing the user to scroll
// up to find it — even though every one of these overlays is
// `position: fixed; inset: 0`, which is supposed to always cover the
// current viewport regardless of scroll position.
//
// The real cause is a well-known mobile WebKit/Chrome quirk: a plain
// `overflow: hidden` on <body> doesn't reliably stop the page underneath
// from still scrolling, and `position: fixed` children can end up
// positioned relative to the full scrollable document rather than the
// visual viewport once the page has been scrolled. The standard fix (used
// by most mobile-aware modal libraries) is to pin <body> itself to
// `position: fixed` at a negative top offset equal to however far the
// page was scrolled — that collapses the document's own scroll position
// to zero for as long as the modal's open, so every fixed-position
// overlay is guaranteed to line up with what's actually on screen. On
// close, the scroll position is restored exactly so the page doesn't jump.
//
// Module-level lock count rather than per-call state — several overlays
// can legitimately be stacked at once (e.g. tapping a poster to zoom it
// while the event ticket popup is still open behind it), and only the
// FIRST one to lock should capture the real scroll position / only the
// LAST one to unlock should actually restore it. Without this, closing
// the top (second) overlay would "restore" to whatever scroll position
// existed when IT opened (already 0, since the body was already pinned by
// the first one), snapping the page to the top instead of back to where
// the user actually was.
let lockCount = 0;
let savedScrollY = 0;

// Call this with `true` for as long as a full-screen overlay is mounted;
// it cleans itself up automatically when the component unmounts or the
// flag flips back to false.
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      const { body } = document;
      body.style.position = "fixed";
      body.style.top = `-${savedScrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        const { body } = document;
        body.style.position = "";
        body.style.top = "";
        body.style.left = "";
        body.style.right = "";
        body.style.width = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}
