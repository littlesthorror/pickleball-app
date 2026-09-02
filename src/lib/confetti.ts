// Lightweight canvas confetti burst — added 2026-09-02 for celebrating a
// newly earned badge / avatar frame upgrade. No dependency (this is ~60
// lines of plain canvas physics, not worth pulling in a package for) — a
// full-viewport fixed canvas is created, animated for a couple of seconds,
// then removed. Respects prefers-reduced-motion by skipping entirely,
// same as any other motion-heavy UI should.

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

const DEFAULT_COLORS = ["#0f2547", "#e05f00", "#ff7a1a", "#2c4d80", "#1a8f5e"];

export function fireConfetti(options: { colors?: string[]; pieceCount?: number } = {}) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const colors = options.colors ?? DEFAULT_COLORS;
  const pieceCount = options.pieceCount ?? 140;

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
    return;
  }
  ctx.scale(dpr, dpr);

  const W = window.innerWidth;
  const H = window.innerHeight;

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
    if (!ctx) return;
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
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
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
