import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import type { PlayerStatus } from "../types";

interface MatchTeams {
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
}

// Deliberately descriptive only — no rankings, no "who's winning," nothing
// that turns into a second leaderboard. Just "here's what the club has
// been up to," computed client-side since a club's match volume is small
// enough that this is simpler than maintaining more SQL views for it.
export default function ClubStats() {
  const [matches, setMatches] = useState<MatchTeams[]>([]);
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase
        .from("matches")
        .select("team_a_player_1_id,team_a_player_2_id,team_b_player_1_id,team_b_player_2_id")
        .eq("status", "confirmed"),
      supabase.from("player_status").select("*").eq("is_active", true),
    ]).then(([matchesRes, playersRes]) => {
      if (matchesRes.error) setError(matchesRes.error.message);
      else setMatches((matchesRes.data ?? []) as MatchTeams[]);
      if (playersRes.error) setError(playersRes.error.message);
      else setPlayers((playersRes.data ?? []) as PlayerStatus[]);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const nameById = new Map(players.map((p) => [p.id, p.display_name]));

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

    let mostActive: { name: string; count: number } | null = null;
    for (const [id, count] of playerGameCounts) {
      if (!mostActive || count > mostActive.count) {
        mostActive = { name: nameById.get(id) ?? "?", count };
      }
    }

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
      mostActive,
      avgRating,
      newest,
    };
  }, [matches, players]);

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
        <h2>Who's playing the most</h2>
        <div className="match-row">
          <div>
            <div className="opponent">Most active player</div>
            <div className="meta">across all confirmed matches</div>
          </div>
          <div className="score">
            {stats.mostActive ? `${stats.mostActive.name} (${stats.mostActive.count})` : "—"}
          </div>
        </div>
        <div className="match-row">
          <div>
            <div className="opponent">Most frequent partnership</div>
            <div className="meta">teammates, not opponents</div>
          </div>
          <div className="score">
            {stats.topPair ? `${stats.topPair.names} (${stats.topPair.count})` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
