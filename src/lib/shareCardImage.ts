import type { Badge } from "./badges";
import type { PlayerStatus } from "../types";
// Imported (rather than referenced as a plain "/share-card-bg.jpg" public
// path) so Vite fingerprints it with a content hash at build time — see
// the matching comment in index.css for why: swapping this photo file
// then reliably busts caches instead of possibly leaving people on the
// old image indefinitely.
import shareCardBgUrl from "../assets/share-card-bg.jpg";

// Hand-drawn on <canvas> rather than photographing the DOM with a library
// like html2canvas — avoids adding a new dependency (and its failure modes
// with border-radius/gradients) just to reproduce a fairly simple card.
// Mirrors the visual design of ShareCard.tsx / Avatar.tsx closely enough
// that the two look like the same card.

export interface ShareCardStats {
  bestPartner: { name: string; wins: number } | null;
  highestWin: { opponentNames: string; opponentRating: number } | null;
  leaderboardPosition: { rank: number; totalRanked: number } | null;
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

// Truncates text with an ellipsis if it's wider than maxWidth, rather than
// letting it overflow into a neighbouring stat box — needed since player
// names and opponent pairings are free text with no length limit.
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * Renders the share card to a PNG blob at a fixed, phone-story-friendly
 * size. If the player's uploaded photo fails to load (e.g. a CORS hiccup),
 * falls back to the initials circle rather than failing the whole share.
 */
export async function renderShareCardImage(
  player: PlayerStatus,
  badges: Badge[],
  stats: ShareCardStats
): Promise<Blob> {
  const W = 640;
  const H = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported on this device.");

  // Court-photo backdrop (Ben's, 2026-08-25), cover-fit and clipped to the
  // card's rounded corners, with the same navy gradient as a translucent
  // wash on top so the white text/stat pills stay legible over a busy
  // photo. Falls back to the old flat gradient if the image can't load
  // (offline, hosting hiccup) — mirrors the same fallback pattern used
  // below for the player's own photo.
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.save();
  ctx.clip();

  let backdropLoaded = false;
  try {
    const backdrop = await loadImage(shareCardBgUrl);
    const scale = Math.max(W / backdrop.width, H / backdrop.height);
    const drawW = backdrop.width * scale;
    const drawH = backdrop.height * scale;
    ctx.drawImage(backdrop, (W - drawW) / 2, (H - drawH) / 2, drawW, drawH);
    backdropLoaded = true;
  } catch {
    // fall through to the flat gradient below
  }
  if (!backdropLoaded) {
    const fallback = ctx.createLinearGradient(0, 0, W * 0.3, H);
    fallback.addColorStop(0, "#0a1a33");
    fallback.addColorStop(1, "#163460");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, H);
  }

  const gradient = ctx.createLinearGradient(0, 0, W * 0.3, H);
  gradient.addColorStop(0, "rgba(10, 26, 51, 0.88)");
  gradient.addColorStop(1, "rgba(22, 52, 96, 0.82)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "600 20px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SIDELINE · HUNTINGDON PICKLEBALL", W / 2, 80);

  // Bigger photo per Ben's 2026-08-25 request (was 200px) — pushed the
  // rest of the layout down/out accordingly.
  const avatarSize = 260;
  const avatarY = 110;
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
    ctx.font = "700 84px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsFor(player.display_name), W / 2, avatarY + avatarSize / 2 + 4);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = "700 34px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(player.display_name, W / 2, avatarBottom + 50);

  const badgeLabel = player.is_provisional ? "PROVISIONAL" : "ESTABLISHED";
  ctx.font = "700 14px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText(badgeLabel, W / 2, avatarBottom + 80);

  ctx.fillStyle = "#fff";
  ctx.font = "800 96px -apple-system, system-ui, sans-serif";
  ctx.fillText(String(Math.round(player.rating)), W / 2, avatarBottom + 200);

  ctx.font = "400 20px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(
    `${player.games_played} game${player.games_played === 1 ? "" : "s"} played`,
    W / 2,
    avatarBottom + 236
  );

  // ── Stats grid (Games played / Leaderboard / Best partner / Highest
  // win) — added 2026-08-25 alongside the bigger photo, at Ben's request.
  const gridTop = avatarBottom + 280;
  const gridMargin = 56;
  const gridGap = 16;
  const boxWidth = (W - gridMargin * 2 - gridGap) / 2;
  const boxHeight = 92;
  const rowGap = 14;

  const leaderboardValue = stats.leaderboardPosition
    ? `#${stats.leaderboardPosition.rank} of ${stats.leaderboardPosition.totalRanked}`
    : "—";
  const bestPartnerValue = stats.bestPartner ? stats.bestPartner.name : "—";
  const highestWinValue = stats.highestWin ? `vs ${stats.highestWin.opponentNames}` : "—";

  const cells: { label: string; value: string }[] = [
    { label: "GAMES PLAYED", value: String(player.games_played) },
    { label: "LEADERBOARD", value: leaderboardValue },
    { label: "BEST PARTNER", value: bestPartnerValue },
    { label: "HIGHEST WIN", value: highestWinValue },
  ];

  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = gridMargin + col * (boxWidth + gridGap);
    const y = gridTop + row * (boxHeight + rowGap);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x, y, boxWidth, boxHeight, 14);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.font = "700 13px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(cell.label, x + boxWidth / 2, y + 30);

    ctx.font = "700 22px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    const fitted = fitText(ctx, cell.value, boxWidth - 24);
    ctx.fillText(fitted, x + boxWidth / 2, y + 62);
  });

  let badgeY = gridTop + 2 * boxHeight + rowGap + 40;
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
