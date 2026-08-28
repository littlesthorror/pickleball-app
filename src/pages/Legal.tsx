import { useBodyScrollLock } from "../lib/useBodyScrollLock";

// Ownership / terms overlay — reachable from the subtle footer link on
// every screen (see App.tsx), rather than being its own nav tab, since it's
// reference material rather than something anyone needs day to day.
export default function Legal({ onClose }: { onClose: () => void }) {
  useBodyScrollLock(true);

  return (
    <div className="legal-overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%" }}>
        <h1 style={{ marginTop: 0 }}>Terms &amp; ownership</h1>
        <p>
          The design, layout, functionality, graphics, and original content of this application are the
          intellectual property of Ben Franklin and Dan Smith unless otherwise stated. No part of this
          application may be copied, reproduced, modified, distributed, or used for commercial purposes
          without prior written permission.
        </p>
        <p>
          Club-specific content, logos, and trademarks remain the property of Huntingdon Pickleball or their
          respective owners where applicable.
        </p>
        <button onClick={onClose} className="btn-sky">
          Close
        </button>
      </div>
    </div>
  );
}
