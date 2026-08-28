import { useState } from "react";
import Avatar from "./Avatar";
import { renderSeasonWrappedImage } from "../lib/seasonWrappedImage";
import type { SeasonWrappedStats } from "../lib/seasonWrappedImage";
import type { PlayerStatus } from "../types";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

// Season Wrapped card (2026-08-28) — same share/download mechanics as
// ShareCard.tsx (native share sheet on phones, falls back to a plain
// download on desktop), styled to the season it's recapping rather than the
// club's fixed navy/orange palette. See lib/seasonWrappedImage.ts for the
// canvas rendering and the seasonal colour themes.
export default function SeasonWrappedCard({
  player,
  stats,
  onClose,
}: {
  player: PlayerStatus;
  stats: SeasonWrappedStats;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  useBodyScrollLock(true);

  async function handleShare() {
    setWorking(true);
    setShareError(null);
    try {
      const blob = await renderSeasonWrappedImage(player, stats);
      const file = new File(
        [blob],
        `${player.display_name.replace(/\s+/g, "-")}-${stats.seasonLabel.replace(/\s+/g, "-")}-wrapped.png`,
        { type: "image/png" }
      );

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `My ${stats.seasonLabel} Wrapped`,
          text: `${player.display_name}'s ${stats.seasonLabel} on Sideline — Huntingdon Pickleball`,
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
        <div className="share-card" style={{ background: "transparent", padding: 0 }}>
          {/* The canvas card itself already draws its own seasonal
              background/branding/stats — this on-screen preview mirrors it
              with plain DOM so it's screenshot-friendly before you even hit
              Share, same principle as ShareCard.tsx. */}
          <div
            style={{
              width: "100%",
              borderRadius: 28,
              padding: "28px 24px",
              textAlign: "center",
              color: "#fff",
              background:
                stats.seasonName === "Spring"
                  ? "linear-gradient(135deg, #1f6d4a, #c2478d)"
                  : stats.seasonName === "Summer"
                  ? "linear-gradient(135deg, #e05f00, #7a1f1f)"
                  : stats.seasonName === "Autumn"
                  ? "linear-gradient(135deg, #b5541f, #3d1f0f)"
                  : "linear-gradient(135deg, #2c5c8a, #0a1a33)",
            }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 600, opacity: 0.7, letterSpacing: "0.04em" }}>
              SIDELINE · HUNTINGDON PICKLEBALL
            </div>
            <div style={{ fontSize: "1.15rem", fontWeight: 800, marginTop: 6, marginBottom: 16 }}>
              {stats.seasonLabel.toUpperCase()} WRAPPED
            </div>
            <Avatar name={player.display_name} url={player.avatar_url} size={92} />
            <div style={{ fontWeight: 700, fontSize: "1.1rem", marginTop: 10 }}>{player.display_name}</div>

            <div style={{ fontSize: "2rem", fontWeight: 800, marginTop: 16 }}>
              {Math.round(stats.startRating)} → {Math.round(stats.endRating)}
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, opacity: 0.85, marginTop: 2 }}>
              {stats.ratingGain > 0 ? "+" : ""}
              {Math.round(stats.ratingGain)} this season
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 20,
              }}
            >
              {[
                { label: "Games played", value: String(stats.games) },
                { label: "Win rate", value: `${stats.winPct}%` },
                { label: "Best partner", value: stats.bestPartner ? stats.bestPartner.name : "—" },
                { label: "Final rank", value: `#${stats.rank}` },
              ].map((cell) => (
                <div
                  key={cell.label}
                  style={{ background: "rgba(255,255,255,0.14)", borderRadius: 14, padding: "10px 8px" }}
                >
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, opacity: 0.7 }}>{cell.label.toUpperCase()}</div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700, marginTop: 4 }}>{cell.value}</div>
                </div>
              ))}
            </div>

            {stats.badgesEarned.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, opacity: 0.7, marginBottom: 8 }}>
                  BADGES EARNED THIS SEASON
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {stats.badgesEarned.slice(0, 3).map((b) => (
                    <span
                      key={b.id}
                      title={b.description}
                      style={{
                        background: "rgba(255,255,255,0.18)",
                        borderRadius: 999,
                        padding: "6px 14px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      {b.emoji} {b.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
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
