import type { Badge } from "./badges";
import type { PlayerStatus } from "../types";
import type { SeasonName } from "./seasons";
import springBackdropUrl from "../assets/season-backdrops/spring.jpg";
import summerBackdropUrl from "../assets/season-backdrops/summer.jpg";
import autumnBackdropUrl from "../assets/season-backdrops/autumn.jpg";
import winterBackdropUrl from "../assets/season-backdrops/winter.jpg";

// Season Wrapped card (2026-08-28) — an end-of-season recap in the same
// spirit as ShareCard/shareCardImage.ts (same canvas-drawing approach, same
// avatar/stat-grid/badge-pill visual language) but themed per season rather
// than using the fixed court-photo backdrop, so a Spring card and a Winter
// card are immediately distinguishable from each other at a glance. Ben's
// explicit request, 2026-08-28: "as nice as the current Share Card... maybe
// even a slight seasonal tweak in colour or the use of emojis... set the
// background for each seasonal image".
//
// Deliberately a separate file/render function rather than extending
// renderShareCardImage with a "mode" flag — the two cards show genuinely
// different stats (season-scoped vs lifetime) and are triggered from
// different places (a specific past season row vs the top-of-dashboard
// share button), so keeping them as two clear, independently-readable
// functions beat threading a big conditional through one.

export interface SeasonWrappedStats {
  seasonName: SeasonName;
  seasonLabel: string;
  games: number;
  wins: number;
  winPct: number;
  startRating: number;
  endRating: number;
  ratingGain: number;
  rank: number;
  bestPartner: { name: string; wins: number } | null;
  badgesEarned: Badge[];
}

// One gradient + accent emoji + photo backdrop per UK meteorological season
// (see lib/seasons.ts). The gradient stops below are drawn as a translucent
// wash (see hexToRgba/WASH_ALPHA) over each season's real club photo, the
// same "photo behind a coloured overlay" treatment shareCardImage.ts uses
// for its court photo — chosen at Ben's request, 2026-08-28: "can you use
// them as backdrops beneath the coloured overlay" / "one photo per season".
const SEASON_THEME: Record<
  SeasonName,
  { emoji: string; gradient: [string, string]; deltaPositive: string; deltaNegative: string; backdrop: string }
> = {
  Spring: { emoji: "🌸", gradient: ["#1f6d4a", "#c2478d"], deltaPositive: "#7be3ad", deltaNegative: "#ffb3b3", backdrop: springBackdropUrl },
  Summer: { emoji: "☀️", gradient: ["#e05f00", "#7a1f1f"], deltaPositive: "#8ef0b0", deltaNegative: "#ffc2c2", backdrop: summerBackdropUrl },
  Autumn: { emoji: "🍂", gradient: ["#b5541f", "#3d1f0f"], deltaPositive: "#8ef0b0", deltaNegative: "#ffc2c2", backdrop: autumnBackdropUrl },
  Winter: { emoji: "❄️", gradient: ["#2c5c8a", "#0a1a33"], deltaPositive: "#8ef0b0", deltaNegative: "#ffc2c2", backdrop: winterBackdropUrl },
};

// How opaque the seasonal gradient wash is over the photo — high enough
// that all the existing white text/pill contrast guarantees still hold
// (this is the same 0.7-0.9-ish range shareCardImage.ts uses over its own
// court photo), low enough that the photo itself is clearly visible rather
// than just tinting a hint of texture through.
const WASH_ALPHA = 0.68;

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const AVATAR_PALETTE = ["#0f2547", "#e05f00", "#2c4d80", "#1a8f5e", "#7a3fb0", "#b0433f"];

function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
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
 * Renders a Season Wrapped card to a PNG blob — same fixed phone-story-
 * friendly size as the regular share card. Falls back to an initials circle
 * if the player's photo can't load, same as renderShareCardImage.
 */
export async function renderSeasonWrappedImage(player: PlayerStatus, stats: SeasonWrappedStats): Promise<Blob> {
  const W = 640;
  const H = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported on this device.");

  const theme = SEASON_THEME[stats.seasonName];

  roundRect(ctx, 0, 0, W, H, 28);
  ctx.save();
  ctx.clip();

  // Photo backdrop — cover-fit, same centring math as shareCardImage.ts's
  // court photo. Falls back to a flat fill of the gradient's first stop if
  // the image can't load for any reason, so a broken asset never breaks the
  // whole card.
  try {
    const backdrop = await loadImage(theme.backdrop);
    const scale = Math.max(W / backdrop.width, H / backdrop.height);
    const drawW = backdrop.width * scale;
    const drawH = backdrop.height * scale;
    ctx.drawImage(backdrop, (W - drawW) / 2, (H - drawH) / 2, drawW, drawH);
  } catch {
    ctx.fillStyle = theme.gradient[0];
    ctx.fillRect(0, 0, W, H);
  }

  // Coloured overlay on top of the photo — translucent version of the same
  // per-season gradient, so the photo reads clearly through it.
  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, hexToRgba(theme.gradient[0], WASH_ALPHA));
  gradient.addColorStop(1, hexToRgba(theme.gradient[1], WASH_ALPHA));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // Faint oversized season emoji scattered behind everything else — a
  // cheap, purely-canvas way to get a "confetti/texture" feel (à la
  // Spotify Wrapped's patterned backgrounds) without shipping any extra
  // image assets.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.font = "160px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(theme.emoji, 90, 150);
  ctx.fillText(theme.emoji, W - 80, 260);
  ctx.fillText(theme.emoji, 100, H - 260);
  ctx.fillText(theme.emoji, W - 90, H - 120);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "600 20px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SIDELINE · HUNTINGDON PICKLEBALL", W / 2, 70);

  ctx.fillStyle = "#fff";
  ctx.font = "800 34px -apple-system, system-ui, sans-serif";
  ctx.fillText(`${theme.emoji} ${stats.seasonLabel.toUpperCase()} WRAPPED`, W / 2, 118);

  // Avatar — smaller than the regular share card (180 vs 260) since this
  // card has more stats competing for vertical space.
  const avatarSize = 180;
  const avatarY = 150;
  const avatarBottom = avatarY + avatarSize;
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let photoLoaded = false;
  if (player.avatar_url) {
    try {
      const img = await loadImage(player.avatar_url);
      ctx.drawImage(img, W / 2 - avatarSize / 2, avatarY, avatarSize, avatarSize);
      photoLoaded = true;
    } catch {
      // fall through to initials
    }
  }
  if (!photoLoaded) {
    ctx.fillStyle = colorForName(player.display_name);
    ctx.fillRect(W / 2 - avatarSize / 2, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = "#fff";
    ctx.font = "700 60px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsFor(player.display_name), W / 2, avatarY + avatarSize / 2 + 4);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = "700 30px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(player.display_name, W / 2, avatarBottom + 42);

  // Rating trajectory — the headline stat, same visual weight as the plain
  // rating number gets on the regular share card.
  const trajectoryY = avatarBottom + 110;
  ctx.font = "800 64px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#fff";
  const trajectoryText = `${Math.round(stats.startRating)} → ${Math.round(stats.endRating)}`;
  ctx.fillText(trajectoryText, W / 2, trajectoryY);

  const deltaColor = stats.ratingGain > 0 ? theme.deltaPositive : stats.ratingGain < 0 ? theme.deltaNegative : "rgba(255,255,255,0.7)";
  ctx.font = "700 22px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = deltaColor;
  const deltaText = `${stats.ratingGain > 0 ? "+" : ""}${Math.round(stats.ratingGain)} this season`;
  ctx.fillText(deltaText, W / 2, trajectoryY + 34);

  // ── Stats grid (Games played / Win rate / Best partner / Final rank)
  const gridTop = trajectoryY + 74;
  const gridMargin = 56;
  const gridGap = 16;
  const boxWidth = (W - gridMargin * 2 - gridGap) / 2;
  const boxHeight = 92;
  const rowGap = 14;

  const cells: { label: string; value: string }[] = [
    { label: "GAMES PLAYED", value: String(stats.games) },
    { label: "WIN RATE", value: `${stats.winPct}%` },
    { label: "BEST PARTNER", value: stats.bestPartner ? stats.bestPartner.name : "—" },
    { label: "FINAL RANK", value: `#${stats.rank}` },
  ];

  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = gridMargin + col * (boxWidth + gridGap);
    const y = gridTop + row * (boxHeight + rowGap);

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, x, y, boxWidth, boxHeight, 14);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.font = "700 13px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(cell.label, x + boxWidth / 2, y + 30);

    ctx.font = "700 22px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    const fitted = fitText(ctx, cell.value, boxWidth - 24);
    ctx.fillText(fitted, x + boxWidth / 2, y + 62);
  });

  // Badges earned this season — up to 3, same pill styling as the regular
  // share card so the two feel like a matched set.
  let badgeY = gridTop + 2 * boxHeight + rowGap + 40;
  const shown = stats.badgesEarned.slice(0, 3);
  if (shown.length > 0) {
    ctx.font = "600 15px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "700 13px -apple-system, system-ui, sans-serif";
    ctx.fillText("BADGES EARNED THIS SEASON", W / 2, badgeY);
    badgeY += 26;

    ctx.font = "600 16px -apple-system, system-ui, sans-serif";
    const paddingX = 16;
    const pillHeight = 32;
    const gap = 8;
    const widths = shown.map((b) => ctx.measureText(`${b.emoji} ${b.label}`).width + paddingX * 2);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (shown.length - 1);
    let x = W / 2 - totalWidth / 2;
    for (let i = 0; i < shown.length; i++) {
      const w = widths[i];
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      roundRect(ctx, x, badgeY, w, pillHeight, pillHeight / 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(`${shown[i].emoji} ${shown[i].label}`, x + w / 2, badgeY + pillHeight / 2 + 5);
      x += w + gap;
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't generate the image."));
    }, "image/png");
  });
}
