import cupBannerUrl from "../assets/quarterly-cup/cup-banner.jpg";

// Quarterly Cup podium graphic (2026-09-15, Ben's request) — a shareable
// image for when a Cup finishes, in the same spirit as
// shareCardImage.ts/seasonWrappedImage.ts (same canvas-drawing approach,
// same photo-backdrop-plus-gradient-wash treatment) but showing the Cup's
// top 3 teams as an actual podium rather than a player's own stats. Kept as
// its own file/render function for the same reason seasonWrappedImage.ts
// is separate from shareCardImage.ts — genuinely different content (a
// whole Cup's result, not one player), triggered from a different place
// (the Cup's own completed-standings card, not a per-player share button).
//
// The gold/silver/bronze bar colours below are the exact --gold-600/
// --silver-600/--bronze-600 tokens index.css already uses for cosmetic
// avatar frame tiers, so the podium reads as visually "the same medal
// language" as the rest of the app rather than inventing new colours.

export interface PodiumTeamStat {
  name: string;
  played: number;
  won: number;
  lost: number;
  pts: number;
}

export interface PodiumStats {
  cupName: string;
  // Already sorted by rank, best first — only the first 3 are drawn.
  teams: PodiumTeamStat[];
}

const GRADIENT: [string, string] = ["#0a1a33", "#e05f00"];
const WASH_ALPHA = 0.68;

const MEDAL: Record<number, { emoji: string; color: string }> = {
  0: { emoji: "🥇", color: "#d4a017" },
  1: { emoji: "🥈", color: "#9aa4b2" },
  2: { emoji: "🥉", color: "#b5722f" },
};

// Tallest in the middle (1st), shorter either side — classic podium shape.
// Index into `teams` (0 = 1st place) mapped to a display column/height.
const COLUMN_ORDER = [1, 0, 2]; // silver, gold, bronze, left to right
const COLUMN_HEIGHT: Record<number, number> = { 0: 240, 1: 190, 2: 150 };

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Renders a Quarterly Cup podium card to a PNG blob — same fixed
 * phone-story-friendly size as the other share cards.
 */
export async function renderPodiumImage(stats: PodiumStats): Promise<Blob> {
  const W = 640;
  const H = 900;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported on this device.");

  roundRect(ctx, 0, 0, W, H, 28);
  ctx.save();
  ctx.clip();

  try {
    const backdrop = await loadImage(cupBannerUrl);
    const scale = Math.max(W / backdrop.width, H / backdrop.height);
    const drawW = backdrop.width * scale;
    const drawH = backdrop.height * scale;
    ctx.drawImage(backdrop, (W - drawW) / 2, (H - drawH) / 2, drawW, drawH);
  } catch {
    ctx.fillStyle = GRADIENT[0];
    ctx.fillRect(0, 0, W, H);
  }

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, hexToRgba(GRADIENT[0], WASH_ALPHA));
  gradient.addColorStop(1, hexToRgba(GRADIENT[1], WASH_ALPHA));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // Faint scattered trophy texture, same trick seasonWrappedImage.ts uses
  // with its seasonal emoji.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.font = "150px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🏆", 90, 150);
  ctx.fillText("🏆", W - 80, 240);
  ctx.fillText("🏆", 100, H - 100);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "600 20px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SIDELINE · HUNTINGDON PICKLEBALL", W / 2, 64);

  ctx.fillStyle = "#fff";
  ctx.font = "800 30px -apple-system, system-ui, sans-serif";
  const cupTitle = fitText(ctx, stats.cupName.toUpperCase(), W - 100);
  ctx.fillText(cupTitle, W / 2, 108);

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "700 16px -apple-system, system-ui, sans-serif";
  ctx.fillText("FINAL STANDINGS", W / 2, 138);

  // ── Podium bars ─────────────────────────────────────────────────────
  const colWidth = 160;
  const colGap = 20;
  const totalWidth = colWidth * 3 + colGap * 2;
  const leftX = (W - totalWidth) / 2;
  const baseline = 740;

  COLUMN_ORDER.forEach((rankIndex, colPos) => {
    const team = stats.teams[rankIndex];
    if (!team) return;
    const medal = MEDAL[rankIndex];
    const height = COLUMN_HEIGHT[rankIndex];
    const x = leftX + colPos * (colWidth + colGap);
    const barTop = baseline - height;

    // Medal + team name above the bar.
    ctx.textAlign = "center";
    ctx.font = "44px -apple-system, system-ui, sans-serif";
    ctx.fillText(medal.emoji, x + colWidth / 2, barTop - 62);

    ctx.fillStyle = "#fff";
    ctx.font = "700 18px -apple-system, system-ui, sans-serif";
    const fittedName = fitText(ctx, team.name, colWidth + 20);
    ctx.fillText(fittedName, x + colWidth / 2, barTop - 20);

    // The bar itself, filled with the medal colour.
    ctx.fillStyle = hexToRgba(medal.color, 0.9);
    roundRect(ctx, x, barTop, colWidth, height, 12);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "800 30px -apple-system, system-ui, sans-serif";
    ctx.fillText(String(team.pts), x + colWidth / 2, barTop + 44);
    ctx.font = "700 13px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("PTS", x + colWidth / 2, barTop + 64);

    // W-L record below the baseline.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 15px -apple-system, system-ui, sans-serif";
    ctx.fillText(`${team.won}W ${team.lost}L · ${team.played}p`, x + colWidth / 2, baseline + 28);
  });

  // Faint podium ground line.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(leftX - 10, baseline);
  ctx.lineTo(leftX + totalWidth + 10, baseline);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "600 14px -apple-system, system-ui, sans-serif";
  ctx.fillText("Full table on the app.", W / 2, H - 40);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't generate the image."));
    }, "image/png");
  });
}
