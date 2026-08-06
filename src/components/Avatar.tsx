// Shows a player's uploaded photo, or a colored initials circle if they
// haven't uploaded one — same pattern most social apps use so the
// leaderboard never has blank/broken image icons.
import type { CSSProperties } from "react";

const PALETTE = ["#0f2547", "#e05f00", "#2c4d80", "#1a8f5e", "#7a3fb0", "#b0433f"];

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
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    objectFit: "cover",
  };

  if (url) {
    return <img src={url} alt={name} style={style} />;
  }

  return (
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
}
