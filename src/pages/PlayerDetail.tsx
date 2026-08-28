import Dashboard from "./Dashboard";

// Reuses the exact same Dashboard component someone sees for their own
// stats — it was already built generically (takes any playerId), so
// viewing a clubmate's dashboard from the leaderboard needed no new
// data-fetching logic, just this thin wrapper with a back button.
export default function PlayerDetail({
  playerId,
  playerName,
  viewerId,
  backLabel = "Back to leaderboard",
  onBack,
}: {
  playerId: string;
  playerName: string;
  // The signed-in user's own player id — passed through to Dashboard so it
  // can show "your record vs this player" (added 2026-08-14).
  viewerId: string;
  // Reflects where the click actually came from (Leaderboard vs Manage
  // admins) rather than always saying "leaderboard" — added 2026-08-28
  // once Manage Admins grew its own click-through to this same view.
  backLabel?: string;
  onBack: () => void;
}) {
  return (
    <div>
      <button
        onClick={onBack}
        style={{
          marginTop: 0,
          marginBottom: 16,
          width: "auto",
          background: "transparent",
          color: "var(--navy-500)",
          padding: 0,
          fontWeight: 600,
        }}
      >
        ← {backLabel}
      </button>
      <h1 style={{ marginBottom: 16 }}>{playerName}</h1>
      <Dashboard playerId={playerId} viewerId={viewerId} />
    </div>
  );
}
