import { useState } from "react";
import { renderPodiumImage } from "../lib/podiumImage";
import type { PodiumStats } from "../lib/podiumImage";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

// Quarterly Cup podium share card (2026-09-15, Ben's request) — same
// share/download mechanics as ShareCard.tsx/SeasonWrappedCard.tsx (native
// share sheet on phones, falls back to a plain download on desktop). See
// lib/podiumImage.ts for the canvas rendering this on-screen preview
// mirrors.
const MEDAL = ["🥇", "🥈", "🥉"];
const COLUMN_ORDER = [1, 0, 2]; // silver, gold, bronze, left to right
const COLUMN_HEIGHT: Record<number, number> = { 0: 160, 1: 120, 2: 90 };
const MEDAL_COLOR: Record<number, string> = { 0: "#d4a017", 1: "#9aa4b2", 2: "#b5722f" };

export default function PodiumShareCard({ stats, onClose }: { stats: PodiumStats; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  useBodyScrollLock(true);

  async function handleShare() {
    setWorking(true);
    setShareError(null);
    try {
      const blob = await renderPodiumImage(stats);
      const file = new File([blob], `${stats.cupName.replace(/\s+/g, "-")}-podium.png`, { type: "image/png" });

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${stats.cupName} — final standings`,
          text: `${stats.cupName} on Sideline — Huntingdon Pickleball`,
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
            <div style={{ fontSize: "1.1rem", fontWeight: 800, marginTop: 6 }}>{stats.cupName.toUpperCase()}</div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, opacity: 0.75, marginTop: 2, marginBottom: 20 }}>
              FINAL STANDINGS
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10 }}>
              {COLUMN_ORDER.map((rankIndex) => {
                const team = stats.teams[rankIndex];
                if (!team) return <div key={rankIndex} style={{ width: 92 }} />;
                return (
                  <div key={rankIndex} style={{ width: 92, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontSize: "1.8rem" }}>{MEDAL[rankIndex]}</div>
                    <div
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        marginTop: 4,
                        marginBottom: 8,
                        maxWidth: 92,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={team.name}
                    >
                      {team.name}
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: COLUMN_HEIGHT[rankIndex],
                        borderRadius: 10,
                        background: MEDAL_COLOR[rankIndex],
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{team.pts}</div>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, opacity: 0.85 }}>PTS</div>
                    </div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 600, opacity: 0.85, marginTop: 6 }}>
                      {team.won}W {team.lost}L
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.6, marginTop: 20 }}>
              Full table on the app.
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
