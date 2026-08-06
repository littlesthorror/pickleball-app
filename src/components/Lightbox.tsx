import { useEffect } from "react";

// Full-screen image viewer for notice attachments — clicking a thumbnail
// opens the photo in place instead of navigating away to a new tab.
export default function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <img
        src={src}
        alt={alt}
        className="lightbox-image"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
