import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import ShareCard from "../components/ShareCard";
import { computeBadges } from "../lib/badges";
import { isBirthdayToday } from "../lib/birthday";
import type { EventRow, PlayerMatchHistoryRow, PlayerStatus } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const NAVY = "#0f2547";
const ORANGE_BAND = "rgba(255, 122, 26, 0.14)";

type XAxisMode = "games" | "date";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Dashboard({
  playerId,
  isOwnProfile = false,
  onViewEvents,
}: {
  playerId: string;
  // Head-to-head records and the "share my card" action are only shown on
  // your own dashboard — not when viewing a clubmate's, via the leaderboard
  // click-through. Keeps this purely self-reflective rather than something
  // people can browse to see how they stack up against a specific person,
  // per Ben's "no unnecessary gloating or unfairness" note (2026-08-04).
  isOwnProfile?: boolean;
  // Lets the "next event" block jump to the Events tab — only wired up on
  // your own dashboard, same as above.
  onViewEvents?: () => void;
}) {
  const [player, setPlayer] = useState<PlayerStatus | null>(null);
  const [history, setHistory] = useState<PlayerMatchHistoryRow[]>([]);
  const [nextEvent, setNextEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [xAxis, setXAxis] = useState<XAxisMode>("games");
  const [showShareCard, setShowShareCard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: playerRow, error: playerErr }, { data: historyRows, error: historyErr }] =
        await Promise.all([
          supabase.from("player_status").select("*").eq("id", playerId).single(),
          supabase
            .from("player_match_history")
            .select("*")
            .eq("player_id", playerId)
            .order("game_number", { ascending: true }),
        ]);
      if (cancelled) return;
      if (playerErr) setError(playerErr.message);
      else setPlayer(playerRow as PlayerStatus);
      if (historyErr) setError(historyErr.message);
      else setHistory((historyRows ?? []) as PlayerMatchHistoryRow[]);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    if (!isOwnProfile) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    supabase
      .from("events")
      .select("*")
      .gte("event_date", todayStr)
      .order("event_date", { ascending: true })
      .limit(1)
      .then(({ data }) => setNextEvent(((data ?? [])[0] as EventRow) ?? null));
  }, [isOwnProfile]);

  const chartData = useMemo(() => {
    if (!player) return null;

    // Synthetic "game 0" point so the chart starts at the fresh-join rating
    // rather than jumping straight into the first match.
    const points = [
      { label: xAxis === "games" ? "Start" : formatDate(player.date_joined), rating: 1500, rd: 350 },
      ...history.map((h) => ({
        label: xAxis === "games" ? String(h.game_number) : formatDate(h.played_at),
        rating: h.post_rating,
        rd: h.post_rd,
      })),
    ];

    const labels = points.map((p) => p.label);
    const upper = points.map((p) => Math.round(p.rating + p.rd));
    const lower = points.map((p) => Math.round(p.rating - p.rd));
    const rating = points.map((p) => Math.round(p.rating));

    return {
      labels,
      datasets: [
        {
          label: "RD lower",
          data: lower,
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
        },
        {
          label: "RD upper",
          data: upper,
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: ORANGE_BAND,
          fill: "-1" as const,
        },
        {
          label: "Rating",
          data: rating,
          borderColor: NAVY,
          backgroundColor: NAVY,
          pointRadius: history.length > 40 ? 0 : 3,
          borderWidth: 2.5,
          tension: 0.25,
          fill: false,
        },
      ],
    };
  }, [player, history, xAxis]);

  const badges = useMemo(
    () => computeBadges(history, player?.games_played ?? 0, player?.date_joined ?? ""),
    [history, player]
  );

  // 30-day change and personal best — both derived from the same history
  // array already loaded for the chart, so no extra query needed. Mirrors
  // the leaderboard's delta_30d logic: null means the player joined less
  // than 30 days ago, so there's no meaningful "30 days ago" to compare to.
  const delta30d = useMemo(() => {
    if (!player) return null;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    if (new Date(player.date_joined) > cutoff) return null;

    let ratingAsOf = 1500;
    for (const h of history) {
      if (new Date(h.played_at) <= cutoff) ratingAsOf = h.post_rating;
      else break;
    }
    return player.rating - ratingAsOf;
  }, [player, history]);

  const personalBest = useMemo(() => {
    let best = { rating: 1500, date: player?.date_joined ?? null as string | null };
    for (const h of history) {
      if (h.post_rating > best.rating) best = { rating: h.post_rating, date: h.played_at };
    }
    return best;
  }, [history, player]);

  // Grouped by exact opponent pairing (that's what the data has — a 2v2
  // match's "opponent" is really a pair, and different pairings against the
  // same person are kept separate rather than trying to split credit per
  // individual). Sorted by games played together, most-faced first.
  const headToHead = useMemo(() => {
    const byOpponent = new Map<string, { wins: number; losses: number }>();
    for (const h of history) {
      const entry = byOpponent.get(h.opponent_names) ?? { wins: 0, losses: 0 };
      if (h.won) entry.wins += 1;
      else entry.losses += 1;
      byOpponent.set(h.opponent_names, entry);
    }
    return [...byOpponent.entries()]
      .map(([opponent, record]) => ({ opponent, ...record, total: record.wins + record.losses }))
      .sort((a, b) => b.total - a.total);
  }, [history]);

  if (loading) return <p>Loading your dashboard…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!player) return <p className="error">Couldn't find your player profile.</p>;

  const lastDelta = history.length > 0 ? history[history.length - 1].rating_delta : null;
  const recent = [...history].reverse().slice(0, 8);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={player.display_name} url={player.avatar_url} size={44} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="player-name-tag">
              {player.display_name}
              {(isOwnProfile || player.date_of_birth_visible) && isBirthdayToday(player.date_of_birth) && (
                <span title="Happy birthday!" style={{ marginLeft: 6 }}>
                  🎂
                </span>
              )}
            </span>
            <span className={`badge ${player.is_provisional ? "badge-provisional" : "badge-established"}`}>
              {player.is_provisional ? "Provisional" : "Established"}
            </span>
          </div>
        </div>
        <div className="stat-hero">
          <span className="value">{Math.round(player.rating)}</span>
          {lastDelta !== null && (
            <span className={lastDelta > 0 ? "delta-positive" : lastDelta < 0 ? "delta-negative" : "delta-neutral"}>
              {lastDelta > 0 ? "▲" : lastDelta < 0 ? "▼" : "–"} {Math.abs(Math.round(lastDelta))} since last game
            </span>
          )}
        </div>
        <p className="stat-meta">
          {player.games_played} game{player.games_played === 1 ? "" : "s"} played
          {player.is_provisional && ` · ${12 - player.games_played} more to become established`}
        </p>
        {isOwnProfile && (
          <button
            onClick={() => setShowShareCard(true)}
            style={{ background: "#001D51" }}
          >
            Share my card
          </button>
        )}
      </div>

      {badges.length > 0 && (
        <div className="card">
          <h2>Badges</h2>
          <div className="badge-grid">
            {badges.map((b) => (
              <div className="badge-tile" key={b.id} title={b.description}>
                <span className="badge-tile-emoji">{b.emoji}</span>
                <span className="badge-tile-label">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ marginBottom: 0 }}>Rating history</h2>
          <div className="toggle-group">
            <button disabled={xAxis === "games"} onClick={() => setXAxis("games")}>
              Games
            </button>
            <button disabled={xAxis === "date"} onClick={() => setXAxis("date")}>
              Date
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
          <div>
            <div className="stat-meta" style={{ marginTop: 0 }}>Last 30 days</div>
            {delta30d === null ? (
              <span className="delta-neutral" style={{ fontWeight: 700 }}>New player</span>
            ) : (
              <span
                className={delta30d > 0 ? "delta-positive" : delta30d < 0 ? "delta-negative" : "delta-neutral"}
                style={{ fontWeight: 700 }}
              >
                {delta30d > 0 ? "+" : ""}
                {Math.round(delta30d)}
              </span>
            )}
          </div>
          <div>
            <div className="stat-meta" style={{ marginTop: 0 }}>Personal best</div>
            <span style={{ fontWeight: 700, color: "var(--navy-900)" }}>
              {Math.round(personalBest.rating)}
              {personalBest.date && (
                <span className="stat-meta" style={{ fontWeight: 400 }}> · {formatDate(personalBest.date)}</span>
              )}
            </span>
          </div>
        </div>

        {chartData && (
          <div style={{ height: 220 }}>
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { intersect: false, mode: "index" } },
                scales: {
                  x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: "#667085" } },
                  y: { grid: { color: "#eef1f6" }, ticks: { color: "#667085" } },
                },
              }}
            />
          </div>
        )}
        <p className="stat-meta" style={{ marginTop: 8 }}>
          Shaded band = rating deviation (confidence). Narrows as your rating becomes more established.
        </p>
      </div>

      <div className="card">
        <h2>Recent matches</h2>
        {recent.length === 0 && <p className="stat-meta">No confirmed matches yet.</p>}
        {recent.map((m) => (
          <div className="match-row" key={m.match_id}>
            <div>
              <div className="opponent">
                {m.won ? "Won" : "Lost"} with {m.teammate_name} vs {m.opponent_names}
              </div>
              <div className="meta">{formatDate(m.played_at)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="score">
                {m.own_score}–{m.opponent_score}
              </div>
              <div className={m.rating_delta > 0 ? "delta-positive" : m.rating_delta < 0 ? "delta-negative" : "delta-neutral"} style={{ fontSize: "0.78rem" }}>
                {m.rating_delta > 0 ? "+" : ""}
                {Math.round(m.rating_delta)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isOwnProfile && headToHead.length > 0 && (
        <div className="card">
          <h2>Head-to-head</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Only visible to you — your own record against clubmates you've played.
          </p>
          {headToHead.map((row) => (
            <div className="match-row" key={row.opponent}>
              <div className="opponent">{row.opponent}</div>
              <div className="score">
                {row.wins}–{row.losses}
              </div>
            </div>
          ))}
        </div>
      )}

      {isOwnProfile && nextEvent && (
        <div className="card next-event-card" onClick={onViewEvents} style={{ cursor: onViewEvents ? "pointer" : "default" }}>
          <p className="stat-meta" style={{ marginTop: 0, marginBottom: 4 }}>
            Next club event
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="opponent">{nextEvent.title}</div>
              <div className="meta">
                {new Date(
                  Number(nextEvent.event_date.slice(0, 4)),
                  Number(nextEvent.event_date.slice(5, 7)) - 1,
                  Number(nextEvent.event_date.slice(8, 10))
                ).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                {nextEvent.location ? ` · ${nextEvent.location}` : ""}
              </div>
            </div>
            <span style={{ color: "var(--navy-500)", fontWeight: 700, fontSize: "1.1rem" }}>→</span>
          </div>
        </div>
      )}

      {isOwnProfile && showShareCard && (
        <ShareCard player={player} badges={badges} onClose={() => setShowShareCard(false)} />
      )}
    </div>
  );
}
