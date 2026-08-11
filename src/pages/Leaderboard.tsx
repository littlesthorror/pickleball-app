import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { LeaderboardRow } from "../types";

type SortMode = "rating" | "improved";

// Keeps the list from growing unbounded as more members join (nearly 200
// at last count) — search narrows things down instantly, and each section
// only renders a page at a time with "show more" beneath it.
const PAGE_SIZE = 20;

// A win-percentage "winner" with only 1-2 games played this month isn't a
// meaningful comparison against someone who's played a dozen — this is
// the minimum games this month before a player is eligible for the
// Highest win % block. Doesn't apply to the other two blocks, since
// those are raw counts (no fluke risk from a tiny sample).
const MIN_GAMES_FOR_WIN_PCT = 3;

interface MonthlyLeader {
  playerId: string;
  value: number;
}

function MonthlyStatCard({
  title,
  monthLabel,
  leader,
  rowsById,
  formatValue,
  onSelectPlayer,
  emptyMessage,
}: {
  title: string;
  monthLabel: string;
  leader: MonthlyLeader | null;
  rowsById: Map<string, LeaderboardRow>;
  formatValue: (value: number) => string;
  onSelectPlayer: (id: string, name: string) => void;
  emptyMessage: string;
}) {
  const player = leader ? rowsById.get(leader.playerId) : undefined;
  return (
    <div className="card">
      <h2 style={{ marginBottom: 0 }}>{title}</h2>
      <p className="stat-meta" style={{ marginBottom: 12 }}>
        {monthLabel}
      </p>
      {leader && player ? (
        <div
          className="leaderboard-row"
          style={{ cursor: "pointer" }}
          onClick={() => onSelectPlayer(player.id, player.display_name)}
        >
          <Avatar name={player.display_name} url={player.avatar_url} size={28} />
          <span className="name">{player.display_name}</span>
          <span className="rating">{formatValue(leader.value)}</span>
        </div>
      ) : (
        <p className="stat-meta">{emptyMessage}</p>
      )}
    </div>
  );
}

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
  const [search, setSearch] = useState("");
  const [visibleEstablished, setVisibleEstablished] = useState(PAGE_SIZE);
  const [visibleProvisional, setVisibleProvisional] = useState(PAGE_SIZE);
  const [monthlyHistory, setMonthlyHistory] = useState<{ player_id: string; won: boolean }[]>([]);

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

  useEffect(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    supabase
      .from("player_match_history")
      .select("player_id, won")
      .gte("played_at", monthStart)
      .then(({ data, error }) => {
        if (!error) setMonthlyHistory((data ?? []) as { player_id: string; won: boolean }[]);
      });
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.display_name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const established = useMemo(() => {
    const list = filteredRows.filter((r) => !r.is_provisional);
    if (sort === "rating") {
      return [...list].sort((a, b) => b.rating - a.rating);
    }
    return [...list].sort((a, b) => (b.delta_30d ?? -Infinity) - (a.delta_30d ?? -Infinity));
  }, [filteredRows, sort]);

  const provisional = useMemo(
    () => [...filteredRows.filter((r) => r.is_provisional)].sort((a, b) => b.rating - a.rating),
    [filteredRows]
  );

  useEffect(() => {
    setVisibleEstablished(PAGE_SIZE);
    setVisibleProvisional(PAGE_SIZE);
  }, [search, sort]);

  const monthLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    []
  );

  // Only players who are active + profile-visible (i.e. already on the
  // leaderboard) are eligible to appear in these blocks.
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const { mostGames, mostWins, highestWinPct } = useMemo(() => {
    const stats = new Map<string, { games: number; wins: number }>();
    for (const h of monthlyHistory) {
      if (!rowsById.has(h.player_id)) continue;
      const entry = stats.get(h.player_id) ?? { games: 0, wins: 0 };
      entry.games += 1;
      if (h.won) entry.wins += 1;
      stats.set(h.player_id, entry);
    }

    let mostGames: MonthlyLeader | null = null;
    let mostWins: MonthlyLeader | null = null;
    let highestWinPct: MonthlyLeader | null = null;

    for (const [playerId, { games, wins }] of stats) {
      if (!mostGames || games > mostGames.value) mostGames = { playerId, value: games };
      if (!mostWins || wins > mostWins.value) mostWins = { playerId, value: wins };
      if (games >= MIN_GAMES_FOR_WIN_PCT) {
        const pct = (wins / games) * 100;
        if (!highestWinPct || pct > highestWinPct.value) highestWinPct = { playerId, value: pct };
      }
    }

    return { mostGames, mostWins, highestWinPct };
  }, [monthlyHistory, rowsById]);

  if (loading) return <p>Loading leaderboard…</p>;
  if (error) return <p className="error">{error}</p>;

  const visibleEstablishedRows = established.slice(0, visibleEstablished);
  const visibleProvisionalRows = provisional.slice(0, visibleProvisional);

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
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
        />
        {established.length === 0 && (
          <p className="stat-meta">
            {search ? `No established players match "${search}".` : "Nobody's established yet (12+ games)."}
          </p>
        )}
        {visibleEstablishedRows.map((p, i) => (
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
        {established.length > visibleEstablished && (
          <button
            onClick={() => setVisibleEstablished((c) => c + PAGE_SIZE)}
            style={{
              marginTop: 12,
              background: "transparent",
              color: "var(--navy-500)",
              border: "1px solid var(--border)",
            }}
          >
            Show more ({established.length - visibleEstablished} more)
          </button>
        )}
      </div>

      <MonthlyStatCard
        title="Most games played"
        monthLabel={monthLabel}
        leader={mostGames}
        rowsById={rowsById}
        formatValue={(v) => String(v)}
        onSelectPlayer={onSelectPlayer}
        emptyMessage="No games played yet this month."
      />

      <MonthlyStatCard
        title="Most wins"
        monthLabel={monthLabel}
        leader={mostWins}
        rowsById={rowsById}
        formatValue={(v) => String(v)}
        onSelectPlayer={onSelectPlayer}
        emptyMessage="No games played yet this month."
      />

      <MonthlyStatCard
        title="Highest win %"
        monthLabel={monthLabel}
        leader={highestWinPct}
        rowsById={rowsById}
        formatValue={(v) => `${Math.round(v)}%`}
        onSelectPlayer={onSelectPlayer}
        emptyMessage={`Nobody's played ${MIN_GAMES_FOR_WIN_PCT}+ games yet this month.`}
      />

      {provisional.length > 0 && (
        <div className="card">
          <h2>Still establishing</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Fewer than 12 games — ratings still settling in, not yet ranked.
          </p>
          {visibleProvisionalRows.map((p) => (
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
          {provisional.length > visibleProvisional && (
            <button
              onClick={() => setVisibleProvisional((c) => c + PAGE_SIZE)}
              style={{
                marginTop: 12,
                background: "transparent",
                color: "var(--navy-500)",
                border: "1px solid var(--border)",
              }}
            >
              Show more ({provisional.length - visibleProvisional} more)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
