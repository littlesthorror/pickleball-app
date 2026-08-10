import { useState } from "react";
import Avatar from "./Avatar";
import { renderShareCardImage } from "../lib/shareCardImage";
import type { Badge } from "../lib/badges";
import type { PlayerStatus } from "../types";

// The card itself is still screenshot-friendly (see the note in the JSX
// below), but there's also a proper "Share" action now: it renders the
// same design to a PNG on a hidden canvas and hands it to the device's
// native share sheet (WhatsApp, Instagram, Messages, etc. all show up
// there on a phone). No platform offers a direct "post to Instagram Story"
// web API, so this is the closest a website can get — on desktop, where
// the share sheet mostly isn't available, it falls back to downloading the
// image instead.
export default function ShareCard({
  player,
  badges,
  onClose,
}: {
  player: PlayerStatus;
  badges: Badge[];
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function handleShare() {
    setWorking(true);
    setShareError(null);
    try {
      const blob = await renderShareCardImage(player, badges);
      const file = new File([blob], `${player.display_name.replace(/\s+/g, "-")}-sideline-card.png`, {
        type: "image/png",
      });

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: "My Sideline card",
          text: `${player.display_name} on Sideline — Huntingdon Pickleball`,
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        setShareError("Your browser doesn't support direct sharing, so the image downloaded instead — attach it to WhatsApp, Instagram, or Facebook from there.");
      }
    } catch (err) {
      // AbortError just means the person closed the native share sheet —
      // not a real failure, so don't show an error for that case.
      if (err instanceof Error && err.name !== "AbortError") {
        setShareError(err.message);
      }
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="share-card-overlay" onClick={onClose}>
      <div className="share-card-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="share-card">
          <div className="share-card-brand">Sideline · Huntingdon Pickleball</div>
          <Avatar name={player.display_name} url={player.avatar_url} size={90} />
          <div className="share-card-name">{player.display_name}</div>
          <span className={`badge ${player.is_provisional ? "badge-provisional" : "badge-established"}`}>
            {player.is_provisional ? "Provisional" : "Established"}
          </span>
          <div className="share-card-rating">{Math.round(player.rating)}</div>
          <div className="share-card-meta">
            {player.games_played} game{player.games_played === 1 ? "" : "s"} played
          </div>
          {badges.length > 0 && (
            <div className="share-card-badges">
              {badges.slice(0, 4).map((b) => (
                <span key={b.id} className="share-card-badge-pill" title={b.description}>
                  {b.emoji} {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
        {shareError && (
          <p className="stat-meta" style={{ textAlign: "center", marginTop: 8 }}>
            {shareError}
          </p>
        )}
        <div className="share-card-actions">
          <button onClick={handleShare} disabled={working} style={{ flex: 2 }}>
            {working ? "Preparing…" : "Share"}
          </button>
          <button onClick={onClose} className="btn-sky" style={{ flex: 1 }}>
            Close
          </button>
        </div>
        <p className="stat-meta" style={{ textAlign: "center", marginTop: 8 }}>
          Or just screenshot this card the normal way.
        </p>
      </div>
    </div>
  );
}
