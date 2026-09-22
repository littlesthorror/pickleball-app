import { useState } from "react";
import { renderAwardsNightImage } from "../lib/awardsNightImage";
import type { AwardsNightStats } from "../lib/awardsNight";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

// Awards Night share card (2026-09-22) — same share/download mechanics as
// PodiumShareCard.tsx/SeasonWrappedCard.tsx (native share sheet on
// phones, falls back to a plain download on desktop). See
// lib/awardsNightImage.ts for the canvas rendering this on-screen preview
// mirrors.
export default function AwardsNightCard({ stats, onClose }: { stats: AwardsNightStats; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  useBodyScrollLock(true);

  async function handleShare() {
    setWorking(true);
    setShareError(null);
    try {
      const blob = await renderAwardsNightImage(stats);
      const file = new File([blob], `${stats.seasonLabel.replace(/\s+/g, "-")}-awards-night.png`, {
        type: "image/png",
      });

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${stats.seasonLabel} Awards Night`,
          text: `${stats.seasonLabel} Awards Night on Sideline — Huntingdon Pickleball`,
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
          <div
            style={{
              width: "100%",
              borderRadius: 28,
              padding: "28px 24px",
              textAlign: "center",
              color: "#fff",
              background: "linear-gradient(135deg, #0a1a33, #e05f00)",
            }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 600, opacity: 0.7, letterSpacing: "0.04em" }}>
              SIDELINE · HUNTINGDON PICKLEBALL
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: 6 }}>🎉 AWARDS NIGHT</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, opacity: 0.85, marginTop: 2 }}>
              {stats.seasonLabel}
            </div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.65, marginBottom: 20 }}>
              {stats.final ? "Final awards" : "So far this season"}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {stats.awards.map((award) => (
                <div
                  key={award.category}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: "rgba(255,255,255,0.14)",
                    borderRadius: 16,
                    padding: "10px 14px",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      flexShrink: 0,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.18)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.5rem",
                    }}
                  >
                    {award.emoji}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 700, opacity: 0.7 }}>
                      {award.category.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 800,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {award.winner}
                    </div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 600, opacity: 0.85, marginTop: 2 }}>
                      {award.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.6, marginTop: 20 }}>
              Full standings on the app.
            </div>
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
