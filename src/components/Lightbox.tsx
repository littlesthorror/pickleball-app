import { useEffect } from "react";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

// Full-screen image viewer for notice attachments — clicking a thumbnail
// opens the photo in place instead of navigating away to a new tab.
// onPrev/onNext/counter are optional — when a notice has more than one
// photo, Notices.tsx passes all three (wrapping around at the ends) so
// admins/members can step through the set without closing and reopening;
// a single-photo notice omits them and no arrows/counter render. Added
// 2026-09-08 at Ben's request.
export default function Lightbox({
  src,
  alt,
  onClose,
  onPrev,
  onNext,
  counter,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  counter?: string;
}) {
  useBodyScrollLock(true);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {onPrev && (
        <button
          className="lightbox-nav lightbox-nav-prev"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}
      <img src={src} alt={alt} className="lightbox-image" onClick={(e) => e.stopPropagation()} />
      {onNext && (
        <button
          className="lightbox-nav lightbox-nav-next"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next photo"
        >
          ›
        </button>
      )}
      {counter && (
        <div className="lightbox-counter" onClick={(e) => e.stopPropagation()}>
          {counter}
        </div>
      )}
    </div>
  );
}
