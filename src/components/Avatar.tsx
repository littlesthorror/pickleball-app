// Shows a player's uploaded photo, or a colored initials circle if they
// haven't uploaded one — same pattern most social apps use so the
// leaderboard never has blank/broken image icons.
import type { CSSProperties } from "react";
import type { FrameTier } from "../lib/badges";

const PALETTE = ["#0f2547", "#e05f00", "#2c4d80", "#1a8f5e", "#7a3fb0", "#b0433f"];

// Cosmetic avatar frame tiers (2026-09-02) — a decorative ring unlocked as
// a player racks up total badges (see getFrameTier in lib/badges.ts). Fixed
// colors regardless of theme, same as the app's other brand accents.
const FRAME_COLORS: Record<FrameTier, string> = {
  bronze: "var(--bronze-600)",
  silver: "var(--silver-600)",
  gold: "var(--gold-600)",
};

function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function Avatar({
  name,
  url,
  size = 32,
  frameTier = null,
}: {
  name: string;
  url?: string | null;
  size?: number;
  // Cosmetic badge-count unlock — see getFrameTier in lib/badges.ts. Omit
  // (or pass null) anywhere a frame doesn't make sense, e.g. tiny inline
  // avatars where a ring would just look like noise.
  frameTier?: FrameTier | null;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    objectFit: "cover",
  };

  const inner = url ? (
    <img src={url} alt={name} style={style} />
  ) : (
    <div
      style={{
        ...style,
        background: colorFor(name),
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.4,
      }}
    >
      {initials(name) || "?"}
    </div>
  );

  if (!frameTier) return inner;

  const ringWidth = Math.max(2, Math.round(size * 0.06));
  return (
    <div
      title={`${frameTier[0].toUpperCase()}${frameTier.slice(1)} frame`}
      style={{
        width: size + ringWidth * 2,
        height: size + ringWidth * 2,
        borderRadius: "50%",
        flexShrink: 0,
        border: `${ringWidth}px solid ${FRAME_COLORS[frameTier]}`,
        boxSizing: "content-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {inner}
    </div>
  );
}
