import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { LeaderboardRow } from "../types";

type SortMode = "rating" | "improved";

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="delta-neutral">new</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className="delta-neutral">–</span>;
  return (
    <span className={rounded > 0 ? "delta-positive" : "delta-negative"}>
      {rounded > 0 ? "+" : ""}
      {rounded}
    </span>
  );
}

export default function Leaderboard({
  onSelectPlayer,
}: {
  onSelectPlayer: (id: string, name: string) => void;
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("rating");

  useEffect(() => {
    supabase
      .from("leaderboard")
      .select("*")
      .eq("is_active", true)
      .eq("profile_visible", true)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data ?? []) as LeaderboardRow[]);
        setLoading(false);
      });
  }, []);

  const established = useMemo(() => {
    const list = rows.filter((r) => !r.is_provisional);
    if (sort === "rating") {
      return [...list].sort((a, b) => b.rating - a.rating);
    }
    return [...list].sort((a, b) => (b.delta_30d ?? -Infinity) - (a.delta_30d ?? -Infinity));
  }, [rows, sort]);

  const provisional = useMemo(
    () => [...rows.filter((r) => r.is_provisional)].sort((a, b) => b.rating - a.rating),
    [rows]
  );

  if (loading) return <p>Loading leaderboard…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ marginBottom: 0 }}>Club leaderboard</h2>
          <div className="toggle-group">
            <button disabled={sort === "rating"} onClick={() => setSort("rating")}>
              Rating
            </button>
            <button disabled={sort === "improved"} onClick={() => setSort("improved")}>
              Most improved
            </button>
          </div>
        </div>
        <p className="stat-meta" style={{ marginBottom: 12 }}>
          {sort === "rating" ? "Ranked by current rating." : "Ranked by rating change over the last 30 days."}
        </p>
        {established.length === 0 && <p className="stat-meta">Nobody's established yet (12+ games).</p>}
        {established.map((p, i) => (
          <div
            className="leaderboard-row"
            key={p.id}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectPlayer(p.id, p.display_name)}
          >
            <span className={`rank ${i < 3 ? "top3" : ""}`}>{i + 1}</span>
            <Avatar name={p.display_name} url={p.avatar_url} size={28} />
            <span className="name">{p.display_name}</span>
            {sort === "improved" ? (
              <DeltaBadge value={p.delta_30d} />
            ) : (
              <>
                <span style={{ width: 56, textAlign: "right" }}>
                  <DeltaBadge value={p.delta_30d} />
                </span>
                <span className="rating">{Math.round(p.rating)}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {provisional.length > 0 && (
        <div className="card">
          <h2>Still establishing</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Fewer than 12 games — ratings still settling in, not yet ranked.
          </p>
          {provisional.map((p) => (
            <div
              className="leaderboard-row"
              key={p.id}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectPlayer(p.id, p.display_name)}
            >
              <span className="badge badge-provisional" style={{ minWidth: 0 }}>
                {p.games_played}/12
              </span>
              <Avatar name={p.display_name} url={p.avatar_url} size={28} />
              <span className="name">{p.display_name}</span>
              <span className="rating">{Math.round(p.rating)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
