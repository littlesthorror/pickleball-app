// Lightweight canvas celebration effects — added 2026-09-02 for badges,
// avatar frame upgrades, tier promotions, personal bests, and birthdays.
// No dependency (this is plain canvas physics, not worth pulling in a
// package for) — a full-viewport fixed canvas is created, animated for a
// few seconds, then removed. Respects prefers-reduced-motion by skipping
// entirely, same as any other motion-heavy UI should.

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
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
  options: { colors?: string[]; pieceCount?: number; shape?: "rect" | "pickleball" } = {}
) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const shape = options.shape ?? "rect";
  const colors = options.colors ?? (shape === "pickleball" ? PICKLEBALL_COLORS : DEFAULT_COLORS);
  const pieceCount = options.pieceCount ?? 140;

  const setup = makeCanvas();
  if (!setup) return;
  const { canvas, ctx, W, H } = setup;

  vibrate(shape === "pickleball" ? [80, 40, 80, 40, 120] : [80, 40, 80]);

  const pieces: ConfettiPiece[] = Array.from({ length: pieceCount }, () => ({
    x: Math.random() * W,
    y: -20 - Math.random() * H * 0.5,
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 3,
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 12,
    size: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

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
