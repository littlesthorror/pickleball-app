// Lightweight canvas celebration effects — added 2026-09-02 for badges,
// avatar frame upgrades, tier promotions, personal bests, and birthdays.
// No dependency (this is plain canvas physics, not worth pulling in a
// package for) — a full-viewport fixed canvas is created, animated for a
// few seconds, then removed. Respects prefers-reduced-motion by skipping
// entirely, same as any other motion-heavy UI should.

export type ConfettiShape =
  | "rect"
  | "pickleball"
  | "pumpkin"
  | "winter"
  | "hearts"
  | "cake"
  | "easter"
  | "fireworks"
  | "shamrock"
  | "stgeorge"
  | "sparks";

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  // Only set for shape "winter" — each piece is independently either a
  // snowflake or a bauble, so a single burst reads as "wintery" rather
  // than a uniform pile of one ornament. Undefined for every other shape.
  pieceShape?: "snow" | "bauble";
}

interface BalloonPiece {
  x: number;
  y: number;
  vy: number;
  swayPhase: number;
  swaySpeed: number;
  swayAmount: number;
  size: number;
  color: string;
}

const DEFAULT_COLORS = ["#0f2547", "#e05f00", "#ff7a1a", "#2c4d80", "#1a8f5e"];
// A pickleball's actual color — bright yellow-green, used only for the
// on-brand "pickleball" confetti shape (reserved for avatar frame unlocks
// per Ben's call, 2026-09-02 — keeps it feeling special rather than
// diluting it into every celebration).
const PICKLEBALL_COLORS = ["#d9e021", "#c9d61a", "#eef24a"];
const BALLOON_COLORS = ["#e05f00", "#2c4d80", "#3c92f2", "#7a3fb0", "#1a8f5e"];
// Seasonal reskins (2026-09-22, Ben's request) — the everyday "rect"
// confetti (badges, tier promotions, personal bests) automatically swaps
// to these during the relevant window; see getSeasonalConfettiShape
// below. Doesn't touch the "pickleball" shape, which every call site
// passes explicitly and which Ben wants kept special year-round for
// avatar frame unlocks.
const PUMPKIN_COLORS = ["#e8720c", "#d35400", "#f39c12"];
const SNOW_COLORS = ["#ffffff", "#dbeeff", "#cfe8ff"];
const BAUBLE_COLORS = ["#c0392b", "#d4a017", "#c0c0c0", "#1a8f5e"];
const HEART_COLORS = ["#e0455f", "#ff6b81", "#d1336b"];
// Frosting-toned pinks/creams for the birthday cake shape — the candle
// flame itself is drawn with a fixed orange, not part of this palette.
const CAKE_COLORS = ["#f7c9d9", "#fbe4ea", "#f2a6c1"];
// Pastel egg colors for the Easter window.
const EASTER_COLORS = ["#ffd6e8", "#fff3b0", "#c7ecee", "#d9c7f2", "#c8f2d4"];
// Bright multicolor for New Year fireworks — deliberately more varied
// than any other palette here since real fireworks are.
const FIREWORK_COLORS = ["#ffd700", "#ff6b6b", "#4fc3f7", "#c0c0c0", "#ff9f43"];
const SHAMROCK_COLORS = ["#1a8f5e", "#2fae74", "#0f6e42"];
// The flag's own colors are hardcoded in the draw branch below (a flag
// only reads correctly in white-and-red, not a shuffled palette) — this
// is just here so the generic per-piece color picker has something valid
// to land on.
const STGEORGE_COLORS = ["#c8102e"];
// Warm ember tones for the Bonfire Night sparks.
const SPARK_COLORS = ["#ff6a00", "#ff9f1a", "#ffcf4d", "#d64545"];

// Easter Sunday's date moves every year (it's tied to the lunar calendar,
// not a fixed day) — this is the standard "anonymous Gregorian" / Meeus/
// Jones/Butcher algorithm for computing it, accurate for any Gregorian
// calendar year. Always lands in March or April, so there's no year-
// boundary edge case to worry about below.
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthDay = h + l - 7 * m + 114;
  const month = Math.floor(monthDay / 31); // 3 = March, 4 = April
  const day = (monthDay % 31) + 1;
  return new Date(year, month - 1, day);
}

// Ben's ask, 2026-09-22: "5 days either side of Easter weekend" — taking
// "Easter weekend" as Good Friday through Easter Monday, so the full
// window is Good Friday minus 5 days through Easter Monday plus 5 days
// (14 days total, centred on the long weekend).
function isWithinEasterWindow(now: Date): boolean {
  const easterSunday = getEasterSunday(now.getFullYear());
  const goodFriday = new Date(easterSunday);
  goodFriday.setDate(easterSunday.getDate() - 2);
  const easterMonday = new Date(easterSunday);
  easterMonday.setDate(easterSunday.getDate() + 1);
  const windowStart = new Date(goodFriday);
  windowStart.setDate(goodFriday.getDate() - 5);
  const windowEnd = new Date(easterMonday);
  windowEnd.setDate(easterMonday.getDate() + 5);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return today >= windowStart && today <= windowEnd;
}

// 31 December-2 January -> fireworks, 1-14 February -> hearts
// (Valentine's), 17 March -> shamrocks (St Patrick's), ~10 days around
// Easter weekend -> pastel eggs, 23 April -> the St George's flag,
// 1 October -> mini pumpkins, 5 November -> Bonfire Night sparks,
// otherwise 1 November-31 December -> a snow/bauble mix. Exported so
// callers (or the future admin panel, should Ben ever want one) can check
// what's currently active without duplicating the date logic. Only
// applies when a call site doesn't pass an explicit shape —
// fireConfetti({ shape: "pickleball" }) always stays a pickleball, and
// the birthday "cake" shape is always fired explicitly too (it depends on
// a player's own DOB, not the calendar alone, so it can't live in this
// date-only helper).
export function getSeasonalConfettiShape(now: Date = new Date()): ConfettiShape | null {
  const month = now.getMonth(); // 0-indexed: 0 = January, 1 = February, 2 = March, 3 = April, 9 = October, 10 = November, 11 = December
  const day = now.getDate();
  // Checked first so it wins over the winter mix's broader Nov-Dec range.
  if ((month === 11 && day === 31) || (month === 0 && day <= 2)) return "fireworks";
  if (month === 1 && day <= 14) return "hearts";
  if (month === 2 && day === 17) return "shamrock";
  if (isWithinEasterWindow(now)) return "easter";
  if (month === 3 && day === 23) return "stgeorge";
  if (month === 9) return "pumpkin";
  // Checked before the winter mix's broader Nov-Dec range, same reasoning
  // as the New Year carve-out above.
  if (month === 10 && day === 5) return "sparks";
  if (month === 10 || month === 11) return "winter";
  return null;
}

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; W: number; H: number } | null {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return null;
  }
  ctx.scale(dpr, dpr);
  return { canvas, ctx, W: window.innerWidth, H: window.innerHeight };
}

// Best-effort only — most desktop browsers don't implement the Vibration
// API at all, and some mobile browsers require a recent user gesture that
// a background achievement check won't have. Silently does nothing when
// unsupported/blocked, which is the correct fallback here.
function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

export function fireConfetti(
  options: { colors?: string[]; pieceCount?: number; shape?: ConfettiShape } = {}
) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  // A call site that doesn't care what shape it gets (badges, tier
  // promotions, personal bests) automatically picks up the seasonal
  // reskin — only an explicit shape (e.g. the frame-unlock "pickleball"
  // call) opts out.
  const shape = options.shape ?? getSeasonalConfettiShape() ?? "rect";
  const colors =
    options.colors ??
    (shape === "pickleball"
      ? PICKLEBALL_COLORS
      : shape === "pumpkin"
      ? PUMPKIN_COLORS
      : shape === "hearts"
      ? HEART_COLORS
      : shape === "cake"
      ? CAKE_COLORS
      : shape === "easter"
      ? EASTER_COLORS
      : shape === "fireworks"
      ? FIREWORK_COLORS
      : shape === "shamrock"
      ? SHAMROCK_COLORS
      : shape === "stgeorge"
      ? STGEORGE_COLORS
      : shape === "sparks"
      ? SPARK_COLORS
      : DEFAULT_COLORS);
  const pieceCount = options.pieceCount ?? 140;

  const setup = makeCanvas();
  if (!setup) return;
  const { canvas, ctx, W, H } = setup;

  vibrate(shape === "pickleball" ? [80, 40, 80, 40, 120] : [80, 40, 80]);

  const pieces: ConfettiPiece[] = Array.from({ length: pieceCount }, () => {
    const pieceShape: "snow" | "bauble" | undefined =
      shape === "winter" ? (Math.random() < 0.5 ? "snow" : "bauble") : undefined;
    const color =
      pieceShape === "snow"
        ? SNOW_COLORS[Math.floor(Math.random() * SNOW_COLORS.length)]
        : pieceShape === "bauble"
        ? BAUBLE_COLORS[Math.floor(Math.random() * BAUBLE_COLORS.length)]
        : colors[Math.floor(Math.random() * colors.length)];
    return {
      x: Math.random() * W,
      y: -20 - Math.random() * H * 0.5,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 3,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      size:
        shape === "pumpkin" || shape === "cake" || shape === "shamrock" || shape === "stgeorge"
          ? 10 + Math.random() * 6
          : 6 + Math.random() * 6,
      color,
      pieceShape,
    };
  });

  const durationMs = 3200;
  const start = performance.now();

  function frame(now: number) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, W, H);

    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.rotation += p.rotationSpeed;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;

      if (shape === "pickleball") {
        const r = p.size / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        // A couple of tiny "holes" so it reads as a pickleball rather than
        // a plain dot, even at this size.
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath();
        ctx.arc(-r * 0.3, -r * 0.2, r * 0.15, 0, Math.PI * 2);
        ctx.arc(r * 0.25, r * 0.15, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "pumpkin") {
        // Squat orange oval body, three faint vertical ridge lines, and a
        // small green stem on top — reads as a pumpkin even at confetti
        // scale without needing a real icon asset.
        const r = p.size / 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 1;
        for (const dx of [-r * 0.4, 0, r * 0.4]) {
          ctx.beginPath();
          ctx.moveTo(dx, -r * 0.78);
          ctx.lineTo(dx, r * 0.78);
          ctx.stroke();
        }
        ctx.fillStyle = "#3d6b3f";
        ctx.fillRect(-r * 0.12, -r * 1.15, r * 0.24, r * 0.45);
      } else if (shape === "winter" && p.pieceShape === "bauble") {
        // Ornament ball with a small gold cap.
        const r = p.size / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#d4a017";
        ctx.fillRect(-r * 0.18, -r * 1.3, r * 0.36, r * 0.4);
      } else if (shape === "winter") {
        // Snowflake — a simple three-line asterisk, cheap to draw and
        // reads fine at this size.
        const r = p.size / 2;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        for (let a = 0; a < 3; a++) {
          ctx.save();
          ctx.rotate((Math.PI / 3) * a);
          ctx.beginPath();
          ctx.moveTo(-r, 0);
          ctx.lineTo(r, 0);
          ctx.stroke();
          ctx.restore();
        }
      } else if (shape === "hearts") {
        // Classic two-lobe heart via bezier curves, small enough to still
        // read clearly at confetti scale.
        const r = p.size / 2;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.3);
        ctx.bezierCurveTo(r, -r * 0.6, r * 1.4, r * 0.5, 0, r * 1.3);
        ctx.bezierCurveTo(-r * 1.4, r * 0.5, -r, -r * 0.6, 0, r * 0.3);
        ctx.fill();
      } else if (shape === "cake") {
        // A little cupcake — rounded frosting dome over a rectangular
        // body, with a candle and flame on top. Used only for the
        // birthday celebration (see Dashboard.tsx), not part of the
        // automatic seasonal rotation above.
        const r = p.size / 2;
        ctx.fillRect(-r, -r * 0.2, r * 2, r * 1.2);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.2, r, r * 0.35, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "#f2c14e";
        ctx.fillRect(-r * 0.08, -r * 1.1, r * 0.16, r * 0.5);
        ctx.fillStyle = "#ff7a1a";
        ctx.beginPath();
        ctx.arc(0, -r * 1.25, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "easter") {
        // A simple pastel egg — an oval body plus a light decorative
        // squiggle band, enough to read as "decorated egg" rather than a
        // plain dot at confetti scale.
        const r = p.size / 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.72, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-r * 0.55, -r * 0.15);
        ctx.quadraticCurveTo(0, r * 0.2, r * 0.55, -r * 0.15);
        ctx.stroke();
      } else if (shape === "fireworks") {
        // A small frozen starburst — radiating spokes with a spark dot at
        // each tip, in a brighter multicolor palette than anything else
        // here so it reads as "fireworks" rather than another confetti
        // shape.
        const r = p.size / 2;
        ctx.strokeStyle = p.color;
        ctx.fillStyle = p.color;
        ctx.lineWidth = 1.5;
        for (let a = 0; a < 5; a++) {
          const ang = (Math.PI * 2 * a) / 5;
          const tipX = Math.cos(ang) * r;
          const tipY = Math.sin(ang) * r;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(tipX, tipY, r * 0.14, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (shape === "shamrock") {
        // Three overlapping circles in a clover arrangement plus a short
        // stem underneath.
        const r = p.size / 2.6;
        for (let a = 0; a < 3; a++) {
          const ang = (Math.PI * 2 * a) / 3 - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(Math.cos(ang) * r * 0.9, Math.sin(ang) * r * 0.9, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillRect(-r * 0.1, r * 0.6, r * 0.2, r * 1.1);
      } else if (shape === "stgeorge") {
        // A small St George's cross flag — fixed white/red regardless of
        // the per-piece palette, since a flag only reads correctly in its
        // real colors.
        const r = p.size / 2;
        const w = r * 1.8;
        const h = r * 1.2;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = "#c8102e";
        ctx.fillRect(-w / 2, -h * 0.12, w, h * 0.24);
        ctx.fillRect(-w * 0.12, -h / 2, w * 0.24, h);
      } else if (shape === "sparks") {
        // A denser, smaller ember burst than the New Year fireworks
        // above, in warm orange/red tones — Bonfire Night, not a party
        // popper.
        const r = p.size / 2;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        for (let a = 0; a < 4; a++) {
          const ang = (Math.PI * 2 * a) / 4 + Math.PI / 8;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(ang) * r * 0.8, Math.sin(ang) * r * 0.8);
          ctx.stroke();
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }

    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(frame);
}

// Rising balloons — used specifically for a player's own birthday (once
// per day), as a gentler, upward-drifting counterpart to the falling
// confetti used for achievements.
export function fireBalloons(options: { colors?: string[]; pieceCount?: number } = {}) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const colors = options.colors ?? BALLOON_COLORS;
  const pieceCount = options.pieceCount ?? 18;

  const setup = makeCanvas();
  if (!setup) return;
  const { canvas, ctx, W, H } = setup;

  vibrate([100, 60, 100, 60, 200]);

  const pieces: BalloonPiece[] = Array.from({ length: pieceCount }, (_, i) => ({
    x: (W / pieceCount) * i + Math.random() * (W / pieceCount),
    y: H + 40 + Math.random() * H * 0.4,
    vy: 1 + Math.random() * 1.2,
    swayPhase: Math.random() * Math.PI * 2,
    swaySpeed: 0.02 + Math.random() * 0.02,
    swayAmount: 20 + Math.random() * 20,
    size: 30 + Math.random() * 18,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const durationMs = 4200;
  const start = performance.now();

  function frame(now: number) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, W, H);

    for (const p of pieces) {
      p.y -= p.vy;
      p.swayPhase += p.swaySpeed;
      const x = p.x + Math.sin(p.swayPhase) * p.swayAmount;
      const fadeOut = p.y < H * 0.25 ? Math.max(0, p.y / (H * 0.25)) : 1;

      ctx.save();
      ctx.globalAlpha = fadeOut;
      ctx.fillStyle = p.color;
      // Balloon body.
      ctx.beginPath();
      ctx.ellipse(x, p.y, p.size / 2, p.size / 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Knot.
      ctx.beginPath();
      ctx.moveTo(x - 4, p.y + p.size / 1.7);
      ctx.lineTo(x + 4, p.y + p.size / 1.7);
      ctx.lineTo(x, p.y + p.size / 1.7 + 7);
      ctx.closePath();
      ctx.fill();
      // String.
      ctx.strokeStyle = "rgba(120,120,120,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, p.y + p.size / 1.7 + 7);
      ctx.lineTo(x, p.y + p.size / 1.7 + 40);
      ctx.stroke();
      ctx.restore();
    }

    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(frame);
}
