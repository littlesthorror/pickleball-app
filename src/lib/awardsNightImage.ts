import type { AwardsNightStats } from "./awardsNight";

// Awards Night canvas renderer (2026-09-22) — same phone-story-friendly
// fixed-size PNG approach as podiumImage.ts/seasonWrappedImage.ts/
// shareCardImage.ts (same photo-free navy/orange gradient-wash treatment
// podiumImage.ts uses, since there's no single "this is the season" photo
// the way each Quarterly Cup or each meteorological season has one), just
// laid out as a stacked list of award rows instead of a podium or a stat
// grid — a variable-length list of 1-5 categories reads better as rows
// than forced into a fixed grid.

const GRADIENT: [string, string] = ["#0a1a33", "#e05f00"];

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

const ROW_HEIGHT = 128;
const ROW_GAP = 16;
const HEADER_HEIGHT = 190;
const FOOTER_HEIGHT = 70;
const W = 640;

/**
 * Renders an Awards Night card to a PNG blob — one row per award category,
 * height grows with however many categories actually got awarded (a
 * season with no upset yet, say, just shows fewer rows rather than an
 * empty placeholder).
 */
export async function renderAwardsNightImage(stats: AwardsNightStats): Promise<Blob> {
  const H = HEADER_HEIGHT + stats.awards.length * (ROW_HEIGHT + ROW_GAP) + FOOTER_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported on this device.");

  roundRect(ctx, 0, 0, W, H, 28);
  ctx.save();
  ctx.clip();

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, GRADIENT[0]);
  gradient.addColorStop(1, GRADIENT[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // Faint scattered trophy/party texture, same trick podiumImage.ts and
  // seasonWrappedImage.ts use.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.font = "150px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🎉", 90, 150);
  ctx.fillText("🏆", W - 80, 240);
  ctx.fillText("🎉", 100, H - 100);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "600 20px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SIDELINE · HUNTINGDON PICKLEBALL", W / 2, 64);

  ctx.fillStyle = "#fff";
  ctx.font = "800 36px -apple-system, system-ui, sans-serif";
  ctx.fillText("🎉 AWARDS NIGHT", W / 2, 112);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "700 18px -apple-system, system-ui, sans-serif";
  const seasonLine = fitText(ctx, stats.seasonLabel.toUpperCase(), W - 100);
  ctx.fillText(seasonLine, W / 2, 142);

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "600 14px -apple-system, system-ui, sans-serif";
  ctx.fillText(stats.final ? "FINAL AWARDS" : "SO FAR THIS SEASON", W / 2, 166);

  const rowMargin = 40;
  const rowWidth = W - rowMargin * 2;

  stats.awards.forEach((award, i) => {
    const y = HEADER_HEIGHT + i * (ROW_HEIGHT + ROW_GAP);

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, rowMargin, y, rowWidth, ROW_HEIGHT, 18);
    ctx.fill();

    // Emoji badge circle on the left.
    const badgeCx = rowMargin + 56;
    const badgeCy = y + ROW_HEIGHT / 2;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(badgeCx, badgeCy, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "40px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(award.emoji, badgeCx, badgeCy + 14);

    const textX = rowMargin + 116;
    const textMaxWidth = rowWidth - 140;

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "700 13px -apple-system, system-ui, sans-serif";
    ctx.fillText(award.category.toUpperCase(), textX, y + 36);

    ctx.fillStyle = "#fff";
    ctx.font = "800 24px -apple-system, system-ui, sans-serif";
    ctx.fillText(fitText(ctx, award.winner, textMaxWidth), textX, y + 68);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 15px -apple-system, system-ui, sans-serif";
    ctx.fillText(fitText(ctx, award.detail, textMaxWidth), textX, y + 94);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "600 14px -apple-system, system-ui, sans-serif";
  ctx.fillText("Full standings on the app.", W / 2, H - 30);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't generate the image."));
    }, "image/png");
  });
}
