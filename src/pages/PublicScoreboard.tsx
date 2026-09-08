import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { computeGroupStandings } from "../lib/competitionStandings";
import type { KnockoutRound, ScoringSystem } from "../types";

// Public, no-login live scoreboard (2026-09-08, Ben's request) — reached
// via a hash route (see main.tsx: "#scoreboard/<token>") rather than a
// real URL path, so it works without any server-side routing/rewrite
// config: a hash never leaves the browser, so "/#scoreboard/xyz" hits the
// server as a plain request for "/", which this app already serves fine.
// Renders completely outside the normal <App> tree (no session check, no
// nav, no ConfirmProvider/ToastProvider) — this page is meant for a
// spectator scanning a QR code printed and stuck up at the courts, not a
// signed-in member.
//
// Data comes from get_public_competition_scoreboard(token), a narrowly-
// scoped SECURITY DEFINER RPC (see 0072 migration) rather than direct
// table reads — RLS on competitions/competition_matches/etc. requires
// `authenticated`, so an anon caller couldn't read them directly even if
// it wanted to. Standings are computed client-side with the exact same
// computeGroupStandings() the admin-facing Competitions page uses, so the
// numbers can never disagree between the two views.

const KNOCKOUT_ROUNDS: { value: KnockoutRound; label: string }[] = [
  { value: "quarterfinal", label: "Quarterfinal" },
  { value: "semifinal", label: "Semifinal" },
  { value: "third_place", label: "3rd place playoff" },
  { value: "final", label: "Final" },
];

interface ScoreboardTeam {
  id: string;
  team_name: string | null;
  player1_name: string;
  player2_name: string;
}
interface ScoreboardGroup {
  id: string;
  name: string;
  sort_order: number;
  team_ids: string[];
}
interface ScoreboardMatch {
  id: string;
  group_id: string | null;
  knockout_round: KnockoutRound | null;
  knockout_slot: number | null;
  team_a_id: string;
  team_b_id: string;
  winner_team_id: string | null;
  team_a_score: number | null;
  team_b_score: number | null;
}
interface ScoreboardData {
  competition: {
    name: string;
    event_date: string | null;
    status: string;
    scoring_system: ScoringSystem;
  };
  teams: ScoreboardTeam[];
  groups: ScoreboardGroup[];
  matches: ScoreboardMatch[];
}

const REFRESH_MS = 20000;

export default function PublicScoreboard({ token }: { token: string }) {
  // undefined = still loading for the first time, null = token invalid or
  // scoreboard turned off, object = real data.
  const [data, setData] = useState<ScoreboardData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    const { data: result, error: rpcError } = await supabase.rpc("get_public_competition_scoreboard", {
      p_token: token,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setError(null);
    setData((result as ScoreboardData | null) ?? null);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const teamById = new Map((data?.teams ?? []).map((t) => [t.id, t]));
  function teamLabel(id: string): string {
    const t = teamById.get(id);
    if (!t) return "?";
    return t.team_name || `${t.player1_name} & ${t.player2_name}`;
  }

  const pageStyle = {
    minHeight: "100vh",
    background: "var(--navy-900)",
    color: "#fff",
  };

  if (data === undefined) {
    return (
      <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading scoreboard…
      </div>
    );
  }

  if (data === null) {
    return (
      <div
        style={{
          ...pageStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "2rem" }}>🏓</div>
        <h1 style={{ margin: 0, fontSize: "1.3rem" }}>Scoreboard not available</h1>
        <p style={{ margin: 0, opacity: 0.75, maxWidth: 320 }}>
          This link isn't live right now — it may have been turned off, or may not exist. Ask the club for an
          up-to-date link.
        </p>
      </div>
    );
  }

  const groupMatches = data.matches.filter((m) => m.group_id);
  const knockoutMatches = data.matches.filter((m) => m.knockout_round);

  return (
    <div style={{ ...pageStyle, padding: "20px 16px 40px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>🏆 {data.competition.name}</div>
          {data.competition.event_date && (
            <div style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: 4 }}>
              {new Date(data.competition.event_date).toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
          )}
          <span
            style={{
              display: "inline-block",
              marginTop: 8,
              padding: "3px 12px",
              borderRadius: 999,
              background: "var(--orange-500)",
              fontWeight: 700,
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {data.competition.status}
          </span>
        </div>

        {data.groups.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: "1.1rem", margin: "0 0 10px" }}>Group standings</h2>
            {[...data.groups]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((g) => {
                const playedInGroup = groupMatches
                  .filter((m) => m.group_id === g.id && m.team_a_score != null && m.team_b_score != null)
                  .map((m) => ({
                    teamAId: m.team_a_id,
                    teamBId: m.team_b_id,
                    teamAScore: m.team_a_score as number,
                    teamBScore: m.team_b_score as number,
                  }));
                const standings = computeGroupStandings(g.team_ids, playedInGroup, data.competition.scoring_system);
                return (
                  <div
                    key={g.id}
                    style={{
                      marginBottom: 16,
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: 10,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>{g.name}</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                      <thead>
                        <tr style={{ opacity: 0.6, textAlign: "left" }}>
                          <th style={{ paddingBottom: 4, fontWeight: 600 }}>Team</th>
                          <th style={{ textAlign: "center", paddingBottom: 4, fontWeight: 600 }}>P</th>
                          <th style={{ textAlign: "center", paddingBottom: 4, fontWeight: 600 }}>W</th>
                          <th style={{ textAlign: "center", paddingBottom: 4, fontWeight: 600 }}>L</th>
                          <th style={{ textAlign: "center", paddingBottom: 4, fontWeight: 600 }}>Diff</th>
                          <th style={{ textAlign: "center", paddingBottom: 4, fontWeight: 600 }}>Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((row) => (
                          <tr key={row.teamId} style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                            <td style={{ padding: "4px 0" }}>{teamLabel(row.teamId)}</td>
                            <td style={{ textAlign: "center" }}>{row.played}</td>
                            <td style={{ textAlign: "center" }}>{row.won}</td>
                            <td style={{ textAlign: "center" }}>{row.lost}</td>
                            <td style={{ textAlign: "center" }}>{row.diff > 0 ? `+${row.diff}` : row.diff}</td>
                            <td style={{ textAlign: "center", fontWeight: 700 }}>{row.pts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
          </div>
        )}

        {knockoutMatches.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: "1.1rem", margin: "0 0 10px" }}>Knockout bracket</h2>
            {KNOCKOUT_ROUNDS.map(({ value, label }) => {
              const roundMatches = knockoutMatches
                .filter((m) => m.knockout_round === value)
                .sort((a, b) => (a.knockout_slot ?? 0) - (b.knockout_slot ?? 0));
              if (roundMatches.length === 0) return null;
              return (
                <div key={value} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, opacity: 0.8, marginBottom: 6, fontSize: "0.85rem" }}>{label}</div>
                  {roundMatches.map((m) => {
                    const played = m.team_a_score != null && m.team_b_score != null;
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background: "rgba(255,255,255,0.06)",
                          borderRadius: 8,
                          padding: "8px 12px",
                          marginBottom: 6,
                          fontSize: "0.88rem",
                          gap: 8,
                        }}
                      >
                        <span style={{ fontWeight: m.winner_team_id === m.team_a_id ? 700 : 400, minWidth: 0 }}>
                          {teamLabel(m.team_a_id)}
                        </span>
                        <span style={{ opacity: 0.7, flexShrink: 0 }}>
                          {played ? `${m.team_a_score} – ${m.team_b_score}` : "vs"}
                        </span>
                        <span
                          style={{
                            fontWeight: m.winner_team_id === m.team_b_id ? 700 : 400,
                            textAlign: "right",
                            minWidth: 0,
                          }}
                        >
                          {teamLabel(m.team_b_id)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {data.groups.length === 0 && knockoutMatches.length === 0 && (
          <p style={{ textAlign: "center", opacity: 0.7 }}>Fixtures haven't been set up yet — check back soon.</p>
        )}

        <p style={{ textAlign: "center", opacity: 0.5, fontSize: "0.75rem", marginTop: 20 }}>
          {error ? `Couldn't refresh: ${error}` : lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </p>
      </div>
    </div>
  );
}
