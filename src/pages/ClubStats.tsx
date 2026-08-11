import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { PlayerStatus } from "../types";

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
}

// A "streak" of 1 isn't really a streak — this is the minimum consecutive
// wins (most recent games first) before a player shows up in the Longest
// active win streak block.
const MIN_STREAK = 2;

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

  useEffect(() => {
    Promise.all([
      supabase
        .from("matches")
        .select("team_a_player_1_id,team_a_player_2_id,team_b_player_1_id,team_b_player_2_id")
        .eq("status", "confirmed"),
      supabase.from("player_status").select("*").eq("is_active", true),
      supabase.from("player_match_history").select("player_id, played_at, won"),
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

  if (loading) return <p>Loading club stats…</p>;
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
    </div>
  );
}
