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

export default function PublicScoreboard({ token, tv = false }: { token: string; tv?: boolean }) {
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

  // TV mode (2026-10-16): every group's table on one non-scrolling screen,
  // for a wall-mounted display. Grid is up to 4 columns wide; rows share the
  // remaining height equally. Text scales with the viewport and with the
  // grid density so ~16 groups still fit on a 1080p TV.
  if (tv) {
    const sortedGroups = [...data.groups].sort((a, b) => a.sort_order - b.sort_order);
    const hasKnockout = knockoutMatches.length > 0;
    const cells = sortedGroups.length;
    const cols = Math.max(1, Math.min(cells, 4));
    const groupRows = Math.ceil(cells / cols);
    // Knockout (when present) is a full-width band under the groups, so
    // quarter/semi/final results are never pushed off the bottom of the screen.
    const rows = Math.max(1, groupRows + (hasKnockout ? 1.5 : 0));
    const maxTeams = Math.max(1, ...sortedGroups.map((g) => g.team_ids.length));
    // Row font size in vh keyed to grid rows / teams per group so a full 4x4 stays legible.
    const rowFs = `${Math.max(1.1, Math.min(2.6, 64 / (rows * (maxTeams + 3))))}vh`;
    const cardStyle = {
      background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
      border: "1px solid rgba(255,255,255,0.12)",
      boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      borderRadius: 14,
      overflow: "hidden",
      fontSize: rowFs,
      minWidth: 0,
      display: "flex",
      flexDirection: "column" as const,
    };
    const cardHeader = {
      background: "linear-gradient(90deg, var(--orange-600), var(--orange-500))",
      color: "#fff",
      fontWeight: 800,
      fontSize: "1.2em",
      padding: "0.5vh 0.9vw",
      letterSpacing: "0.04em",
      textTransform: "uppercase" as const,
    };
    const statusLabel = data.competition.status.replace(/_/g, " ");
    const dateLabel = data.competition.event_date
      ? new Date(data.competition.event_date).toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";

    return (
      <div
        style={{
          height: "100vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: "1.4vh 1.4vw",
          boxSizing: "border-box",
          color: "#fff",
          background:
            "radial-gradient(ellipse at 15% 0%, #1d4f9a 0%, rgba(29,79,154,0) 45%), radial-gradient(ellipse at 100% 100%, rgba(255,122,26,0.22) 0%, rgba(255,122,26,0) 40%), linear-gradient(180deg, var(--navy-800), var(--navy-900))",
        }}
      >
        <style>{`
          @keyframes tvPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
        `}</style>
        <div style={{ display: "flex", alignItems: "center", gap: "1.2vw", marginBottom: "1.4vh" }}>
          <img
            src="/logo.png"
            alt=""
            style={{ height: "9vh", width: "9vh", objectFit: "contain", filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.5))" }}
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "1.7vh", letterSpacing: "0.3em", textTransform: "uppercase", color: "#7fc0ff", fontWeight: 700 }}>
              Huntingdon Pickleball
            </div>
            <div style={{ fontSize: "4.6vh", fontWeight: 800, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {data.competition.name}
            </div>
            {dateLabel && <div style={{ fontSize: "1.7vh", opacity: 0.65, marginTop: "0.3vh" }}>{dateLabel}</div>}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.6vw",
                padding: "0.7vh 1.2vw",
                borderRadius: 999,
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.18)",
                fontSize: "2vh",
                fontWeight: 800,
                letterSpacing: "0.12em",
              }}
            >
              <span
                style={{
                  width: "1.3vh",
                  height: "1.3vh",
                  borderRadius: "50%",
                  background: error ? "#ff5a5a" : "#3ddc84",
                  animation: "tvPulse 1.8s ease-in-out infinite",
                }}
              />
              LIVE
            </div>
            <div style={{ fontSize: "1.5vh", opacity: 0.6, marginTop: "0.6vh", textTransform: "capitalize" }}>
              {error ? "Reconnecting…" : `${statusLabel}${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`}
            </div>
          </div>
        </div>
        {sortedGroups.length === 0 && !hasKnockout ? (
          <p style={{ textAlign: "center", opacity: 0.7, fontSize: "2.4vh" }}>
            Fixtures haven't been set up yet — check back soon.
          </p>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: [groupRows > 0 ? `repeat(${groupRows}, minmax(0, 1fr))` : null, hasKnockout ? "minmax(0, 1.5fr)" : null].filter(Boolean).join(" "),
              gap: "1.4vh 1vw",
            }}
          >
            {sortedGroups.map((g) => {
              const played = groupMatches
                .filter((m) => m.group_id === g.id && m.team_a_score != null && m.team_b_score != null)
                .map((m) => ({
                  teamAId: m.team_a_id,
                  teamBId: m.team_b_id,
                  teamAScore: m.team_a_score as number,
                  teamBScore: m.team_b_score as number,
                }));
              const standings = computeGroupStandings(g.team_ids, played, data.competition.scoring_system);
              return (
                <div key={g.id} style={cardStyle}>
                  <div style={cardHeader}>{g.name}</div>
                  <div style={{ padding: "0.5vh 0.9vw 0.7vh", flex: 1, minHeight: 0 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "7%" }} />
                        <col />
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "14%" }} />
                      </colgroup>
                      <thead>
                        <tr style={{ opacity: 0.55, fontSize: "0.75em", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          <th />
                          <th style={{ textAlign: "left" }}>Team</th>
                          <th>P</th>
                          <th>W</th>
                          <th>L</th>
                          <th>Dif</th>
                          <th>Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((row, i) => (
                          <tr
                            key={row.teamId}
                            style={{
                              borderTop: "1px solid rgba(255,255,255,0.1)",
                              textAlign: "center",
                              background: i === 0 && row.played > 0 ? "rgba(255,122,26,0.16)" : undefined,
                            }}
                          >
                            <td style={{ fontWeight: 800, color: i <= 1 ? "var(--orange-500)" : "#7fc0ff", padding: "0.3vh 0" }}>
                              {i + 1}
                            </td>
                            <td style={{ textAlign: "left", padding: "0.3vh 0.4vw 0.3vh 0.9vw", lineHeight: 1.1, fontWeight: i === 0 ? 700 : 500 }}>
                              {teamLabel(row.teamId)}
                            </td>
                            <td style={{ opacity: 0.8 }}>{row.played}</td>
                            <td style={{ opacity: 0.8 }}>{row.won}</td>
                            <td style={{ opacity: 0.8 }}>{row.lost}</td>
                            <td style={{ opacity: 0.8 }}>{row.diff > 0 ? `+${row.diff}` : row.diff}</td>
                            <td style={{ fontWeight: 800, fontSize: "1.15em" }}>{row.pts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {hasKnockout && (
              <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
                <div style={{ ...cardHeader, background: "linear-gradient(90deg, #1d6fd1, #4aa3ff)" }}>Knockout</div>
                <div
                  style={{
                    padding: "0.6vh 0.9vw",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    gap: "1.2vw",
                    overflow: "hidden",
                  }}
                >
                  {KNOCKOUT_ROUNDS.map(({ value, label }) => {
                    const rm = knockoutMatches
                      .filter((m) => m.knockout_round === value)
                      .sort((a, b) => (a.knockout_slot ?? 0) - (b.knockout_slot ?? 0));
                    if (rm.length === 0) return null;
                    return (
                      <div key={value} style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ opacity: 0.65, fontSize: "0.75em", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3vh" }}>
                          {label}
                        </div>
                        {rm.map((m) => {
                          const done = m.team_a_score != null && m.team_b_score != null;
                          return (
                            <div
                              key={m.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 6,
                                lineHeight: 1.1,
                                padding: "0.25vh 0",
                                borderTop: "1px solid rgba(255,255,255,0.1)",
                              }}
                            >
                              <span style={{ fontWeight: m.winner_team_id === m.team_a_id ? 800 : 400, minWidth: 0 }}>
                                {teamLabel(m.team_a_id)}
                              </span>
                              <span style={{ opacity: 0.9, flexShrink: 0, fontWeight: 800 }}>
                                {done ? `${m.team_a_score}–${m.team_b_score}` : "vs"}
                              </span>
                              <span
                                style={{
                                  fontWeight: m.winner_team_id === m.team_b_id ? 800 : 400,
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
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

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
