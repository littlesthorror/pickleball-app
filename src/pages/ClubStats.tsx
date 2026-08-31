import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { PlayerStatus } from "../types";
import PageLoading from "../components/PageLoading";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface MatchTeams {
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
}

interface HistoryRow {
  player_id: string;
  played_at: string;
  won: boolean;
  // Added for the Top 7 trajectory chart below — the player's rating as
  // it stood right after this match.
  post_rating: number;
}

// A "streak" of 1 isn't really a streak — this is the minimum consecutive
// wins (most recent games first) before a player shows up in the Longest
// active win streak block.
const MIN_STREAK = 2;

// How many of the club's current top-rated players to track on the
// trajectory chart — recomputed live from current ratings each render, so
// it's always whoever's actually in the top 7 today, not a fixed list.
const TOP_N = 7;

// Distinct, readable-on-white line colours for up to 7 players at once —
// the app's own navy/orange brand pair lead, then five more distinguishable
// hues fill out the rest.
const TRAJECTORY_COLORS = ["#e05f00", "#0f2547", "#3c92f2", "#16a34a", "#a855f7", "#be123c", "#0891b2"];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

type RangeMonths = 3 | 6 | 12;

// How far back "past competitions" looks — Ben's ask was specifically
// "within the past 12-15 months" rather than forever, so older
// competitions quietly age out of this list instead of piling up.
const COMPETITION_HISTORY_MONTHS = 15;

const PLACEMENT_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

interface PastCompetition {
  id: string;
  name: string;
  event_date: string | null;
  placements: { placement: number; teamLabel: string }[];
}

// Deliberately descriptive only — no rankings, no "who's winning," nothing
// that turns into a second leaderboard. Just "here's what the club has
// been up to," computed client-side since a club's match volume is small
// enough that this is simpler than maintaining more SQL views for it.
export default function ClubStats() {
  const [matches, setMatches] = useState<MatchTeams[]>([]);
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeMonths, setRangeMonths] = useState<RangeMonths>(6);
  const [pastCompetitions, setPastCompetitions] = useState<PastCompetition[]>([]);

  useEffect(() => {
    Promise.all([
      supabase
        .from("matches")
        .select("team_a_player_1_id,team_a_player_2_id,team_b_player_1_id,team_b_player_2_id")
        .eq("status", "confirmed"),
      supabase.from("player_status").select("*").eq("is_active", true),
      supabase.from("player_match_history").select("player_id, played_at, won, post_rating"),
    ]).then(([matchesRes, playersRes, historyRes]) => {
      if (matchesRes.error) setError(matchesRes.error.message);
      else setMatches((matchesRes.data ?? []) as MatchTeams[]);
      if (playersRes.error) setError(playersRes.error.message);
      else setPlayers((playersRes.data ?? []) as PlayerStatus[]);
      if (historyRes.error) setError(historyRes.error.message);
      else setHistory((historyRes.data ?? []) as HistoryRow[]);
      setLoading(false);
    });
  }, []);

  // Past competitions (2026-08-26) — completed competitions from the last
  // 12-15 months, with their final placements. Fetched separately from the
  // main stats above since it's an unrelated dataset with its own loading
  // lifecycle; a failure here shouldn't block the rest of the page.
  useEffect(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - COMPETITION_HISTORY_MONTHS);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    supabase
      .from("competitions")
      .select("id, name, event_date, competition_results(placement, team_id)")
      .eq("status", "completed")
      .or(`event_date.gte.${cutoffIso},event_date.is.null`)
      .order("event_date", { ascending: false })
      .then(async ({ data, error }) => {
        if (error || !data || data.length === 0) return;

        const teamIds = Array.from(
          new Set(data.flatMap((c) => (c.competition_results ?? []).map((r) => r.team_id)))
        );
        if (teamIds.length === 0) return;

        const { data: teams } = await supabase
          .from("competition_teams")
          .select("id, team_name, player1_id, player2_id")
          .in("id", teamIds);
        const playerIds = Array.from(
          new Set((teams ?? []).flatMap((t) => [t.player1_id, t.player2_id]))
        );
        const { data: teamPlayers } = await supabase
          .from("players")
          .select("id, display_name")
          .in("id", playerIds);
        const nameById = new Map((teamPlayers ?? []).map((p) => [p.id, p.display_name]));
        const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

        function teamLabel(teamId: string): string {
          const t = teamById.get(teamId);
          if (!t) return "?";
          return t.team_name || `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`;
        }

        setPastCompetitions(
          data.map((c) => ({
            id: c.id,
            name: c.name,
            event_date: c.event_date,
            // Top 3 only (2026-08-29, Ben's request) — the 4th-place
            // semifinal loser (or, with a 3rd-place playoff, the runner-up
            // of it) isn't really a podium finish worth surfacing here.
            placements: (c.competition_results ?? [])
              .filter((r) => r.placement <= 3)
              .map((r) => ({ placement: r.placement, teamLabel: teamLabel(r.team_id) }))
              .sort((a, b) => a.placement - b.placement),
          }))
        );
      });
  }, []);

  const stats = useMemo(() => {
    const nameById = new Map(players.map((p) => [p.id, p.display_name]));
    const avatarById = new Map(players.map((p) => [p.id, p.avatar_url]));

    const pairCounts = new Map<string, number>();
    const playerGameCounts = new Map<string, number>();

    function addPair(a: string, b: string) {
      const key = [a, b].sort().join("|");
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    function addPlayer(id: string) {
      playerGameCounts.set(id, (playerGameCounts.get(id) ?? 0) + 1);
    }

    matches.forEach((m) => {
      addPair(m.team_a_player_1_id, m.team_a_player_2_id);
      addPair(m.team_b_player_1_id, m.team_b_player_2_id);
      [m.team_a_player_1_id, m.team_a_player_2_id, m.team_b_player_1_id, m.team_b_player_2_id].forEach(
        addPlayer
      );
    });

    let topPair: { names: string; count: number } | null = null;
    for (const [key, count] of pairCounts) {
      if (!topPair || count > topPair.count) {
        const [a, b] = key.split("|");
        topPair = { names: `${nameById.get(a) ?? "?"} & ${nameById.get(b) ?? "?"}`, count };
      }
    }

    // Top 3 by total confirmed matches played, all-time — only counts
    // currently-active players (matches nameById lookup).
    const mostMatchesTop3 = Array.from(playerGameCounts.entries())
      .filter(([id]) => nameById.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({ id, name: nameById.get(id)!, count }));

    // Current active win streak per player: walk each player's games most
    // recent-first, counting consecutive wins until the first loss. A
    // reset player's pre-reset games are already excluded by the
    // player_match_history view, so a streak never crosses a reset.
    const historyByPlayer = new Map<string, HistoryRow[]>();
    for (const h of history) {
      if (!nameById.has(h.player_id)) continue;
      const list = historyByPlayer.get(h.player_id) ?? [];
      list.push(h);
      historyByPlayer.set(h.player_id, list);
    }

    const streakTop3 = Array.from(historyByPlayer.entries())
      .map(([id, rows]) => {
        const sorted = [...rows].sort(
          (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
        );
        let streak = 0;
        for (const r of sorted) {
          if (!r.won) break;
          streak++;
        }
        return { id, name: nameById.get(id)!, streak };
      })
      .filter((s) => s.streak >= MIN_STREAK)
      .sort((a, b) => b.streak - a.streak)
      .slice(0, 3);

    const established = players.filter((p) => !p.is_provisional);
    const avgRating =
      established.length > 0
        ? established.reduce((sum, p) => sum + p.rating, 0) / established.length
        : null;

    const newest = [...players].sort(
      (a, b) => new Date(b.date_joined).getTime() - new Date(a.date_joined).getTime()
    )[0];

    return {
      totalMatches: matches.length,
      totalPlayers: players.length,
      topPair,
      mostMatchesTop3,
      streakTop3,
      avatarById,
      avgRating,
      newest,
    };
  }, [matches, players, history]);

  // Whoever's currently rated highest, right now — recomputed every render
  // from live ratings rather than stored anywhere, so the chart below
  // always reflects the current top 7 even as standings shift week to
  // week. Provisional players are excluded, same rule the Leaderboard uses
  // for its "ranked by rating" view — their ratings aren't settled enough
  // yet to call them a top performer.
  const topPlayers = useMemo(
    () =>
      [...players]
        .filter((p) => !p.is_provisional)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, TOP_N),
    [players]
  );

  // Builds a multi-line dataset of each top-7 player's rating right after
  // every confirmed match they played within the selected window. Chart.js
  // is used with a plain linear x-axis (days since the earliest point in
  // view) rather than its time scale, since that needs a date-adapter
  // package this project doesn't otherwise depend on — the tick/tooltip
  // callbacks below convert those day-offsets back into real dates.
  const trajectory = useMemo(() => {
    if (topPlayers.length === 0) return null;
    const topIds = new Set(topPlayers.map((p) => p.id));
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - rangeMonths);
    const cutoffMs = cutoff.getTime();

    const relevant = history.filter((h) => topIds.has(h.player_id) && new Date(h.played_at).getTime() >= cutoffMs);
    if (relevant.length === 0) return null;

    const minTime = Math.min(...relevant.map((h) => new Date(h.played_at).getTime()));

    const byPlayer = new Map<string, { x: number; y: number }[]>();
    for (const h of relevant) {
      const days = (new Date(h.played_at).getTime() - minTime) / MS_PER_DAY;
      const list = byPlayer.get(h.player_id) ?? [];
      list.push({ x: days, y: h.post_rating });
      byPlayer.set(h.player_id, list);
    }

    const datasets = topPlayers
      .map((p, i) => {
        const points = (byPlayer.get(p.id) ?? []).sort((a, b) => a.x - b.x);
        if (points.length === 0) return null;
        const color = TRAJECTORY_COLORS[i % TRAJECTORY_COLORS.length];
        return {
          label: p.display_name,
          data: points,
          borderColor: color,
          backgroundColor: color,
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 2,
          tension: 0.25,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (datasets.length === 0) return null;
    return { datasets, minTime };
  }, [history, topPlayers, rangeMonths]);

  if (loading) return <PageLoading label="Loading club stats…" />;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <div className="card">
        <h2>Club at a glance</h2>
        <div className="match-row">
          <div className="opponent">Matches played</div>
          <div className="score">{stats.totalMatches}</div>
        </div>
        <div className="match-row">
          <div className="opponent">Active players</div>
          <div className="score">{stats.totalPlayers}</div>
        </div>
        <div className="match-row">
          <div className="opponent">Average rating (established players)</div>
          <div className="score">{stats.avgRating ? Math.round(stats.avgRating) : "—"}</div>
        </div>
        {stats.newest && (
          <div className="match-row">
            <div className="opponent">Newest member</div>
            <div className="score" style={{ fontWeight: 600 }}>{stats.newest.display_name}</div>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ marginBottom: 0 }}>Top 7 players — rating trajectory</h2>
          <div className="toggle-group">
            <button disabled={rangeMonths === 3} onClick={() => setRangeMonths(3)}>
              3m
            </button>
            <button disabled={rangeMonths === 6} onClick={() => setRangeMonths(6)}>
              6m
            </button>
            <button disabled={rangeMonths === 12} onClick={() => setRangeMonths(12)}>
              1y
            </button>
          </div>
        </div>
        <p className="stat-meta" style={{ marginBottom: 12 }}>
          Whoever's currently rated highest, updated automatically as the standings change.
        </p>
        {trajectory ? (
          <div style={{ height: 280 }}>
            <Line
              data={{ datasets: trajectory.datasets }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: "bottom",
                    labels: { boxWidth: 10, font: { size: 11 }, color: "#667085" },
                  },
                  tooltip: {
                    callbacks: {
                      title: (items) => {
                        if (!items.length) return "";
                        const t = trajectory.minTime + Number(items[0].parsed.x) * MS_PER_DAY;
                        return new Date(t).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        });
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    type: "linear",
                    grid: { display: false },
                    ticks: {
                      color: "#667085",
                      maxTicksLimit: 6,
                      callback: (value) => {
                        const t = trajectory.minTime + Number(value) * MS_PER_DAY;
                        return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
                      },
                    },
                  },
                  y: { grid: { color: "#eef1f6" }, ticks: { color: "#667085" } },
                },
              }}
            />
          </div>
        ) : (
          <p className="stat-meta">Not enough recent match history yet to plot this.</p>
        )}
      </div>

      <div className="card">
        <h2>Most matches played</h2>
        <p className="stat-meta" style={{ marginBottom: 12 }}>
          All-time, across all confirmed matches.
        </p>
        {stats.mostMatchesTop3.length > 0 ? (
          stats.mostMatchesTop3.map((p, i) => (
            <div className="leaderboard-row" key={p.id}>
              <span className="rank top3">{i + 1}</span>
              <Avatar name={p.name} url={stats.avatarById.get(p.id) ?? null} size={28} />
              <span className="name">{p.name}</span>
              <span className="rating">{p.count}</span>
            </div>
          ))
        ) : (
          <p className="stat-meta">No matches played yet.</p>
        )}
      </div>

      <div className="card">
        <h2>Longest active win streaks</h2>
        <p className="stat-meta" style={{ marginBottom: 12 }}>
          Consecutive wins, most recent game first.
        </p>
        {stats.streakTop3.length > 0 ? (
          stats.streakTop3.map((p, i) => (
            <div className="leaderboard-row" key={p.id}>
              <span className="rank top3">{i + 1}</span>
              <Avatar name={p.name} url={stats.avatarById.get(p.id) ?? null} size={28} />
              <span className="name">{p.name}</span>
              <span className="rating">{p.streak}</span>
            </div>
          ))
        ) : (
          <p className="stat-meta">Nobody's on a streak of {MIN_STREAK}+ right now.</p>
        )}
      </div>

      <div className="card">
        <h2>Most frequent partnership</h2>
        <div className="match-row">
          <div>
            <div className="opponent">{stats.topPair ? stats.topPair.names : "—"}</div>
            <div className="meta">teammates, not opponents</div>
          </div>
          <div className="score">{stats.topPair ? stats.topPair.count : "—"}</div>
        </div>
      </div>

      {pastCompetitions.length > 0 && (
        <div className="card">
          <h2>Past competitions</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Last {COMPETITION_HISTORY_MONTHS} months.
          </p>
          {pastCompetitions.map((c) => (
            <div key={c.id} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div className="stat-meta" style={{ marginTop: 0, marginBottom: 6 }}>
                {c.event_date
                  ? new Date(c.event_date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
                  : ""}
              </div>
              {c.placements.map((p) => (
                <div className="match-row" key={p.placement}>
                  <div className="opponent">
                    {PLACEMENT_MEDAL[p.placement] ?? `${p.placement}th`} {p.teamLabel}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
