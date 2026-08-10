import type { Badge } from "./badges";
import type { PlayerStatus } from "../types";

// Hand-drawn on <canvas> rather than photographing the DOM with a library
// like html2canvas — avoids adding a new dependency (and its failure modes
// with border-radius/gradients) just to reproduce a fairly simple card.
// Mirrors the visual design of ShareCard.tsx / Avatar.tsx closely enough
// that the two look like the same card.

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

/**
 * Renders the share card to a PNG blob at a fixed, phone-story-friendly
 * size. If the player's uploaded photo fails to load (e.g. a CORS hiccup),
 * falls back to the initials circle rather than failing the whole share.
 */
export async function renderShareCardImage(player: PlayerStatus, badges: Badge[]): Promise<Blob> {
  const W = 640;
  const H = 800;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported on this device.");

  const gradient = ctx.createLinearGradient(0, 0, W * 0.3, H);
  gradient.addColorStop(0, "#0a1a33");
  gradient.addColorStop(1, "#163460");
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "600 20px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SIDELINE · HUNTINGDON PICKLEBALL", W / 2, 90);

  const avatarSize = 200;
  const avatarY = 140;
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
    ctx.font = "700 64px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsFor(player.display_name), W / 2, avatarY + avatarSize / 2 + 4);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = "700 34px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(player.display_name, W / 2, avatarY + avatarSize + 56);

  const badgeLabel = player.is_provisional ? "PROVISIONAL" : "ESTABLISHED";
  ctx.font = "700 14px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText(badgeLabel, W / 2, avatarY + avatarSize + 86);

  ctx.fillStyle = "#fff";
  ctx.font = "800 96px -apple-system, system-ui, sans-serif";
  ctx.fillText(String(Math.round(player.rating)), W / 2, avatarY + avatarSize + 210);

  ctx.font = "400 20px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(
    `${player.games_played} game${player.games_played === 1 ? "" : "s"} played`,
    W / 2,
    avatarY + avatarSize + 246
  );

  let badgeY = avatarY + avatarSize + 300;
  const shown = badges.slice(0, 3);
  if (shown.length > 0) {
    ctx.font = "600 16px -apple-system, system-ui, sans-serif";
    const paddingX = 16;
    const pillHeight = 32;
    const gap = 8;
    const widths = shown.map((b) => ctx.measureText(`${b.emoji} ${b.label}`).width + paddingX * 2);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (shown.length - 1);
    let x = W / 2 - totalWidth / 2;
    for (let i = 0; i < shown.length; i++) {
      const w = widths[i];
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      roundRect(ctx, x, badgeY, w, pillHeight, pillHeight / 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(`${shown[i].emoji} ${shown[i].label}`, x + w / 2, badgeY + pillHeight / 2 + 5);
      x += w + gap;
    }
    badgeY += pillHeight + 24;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't generate the image."));
    }, "image/png");
  });
}
