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
import type { MonthlyFinish, CompetitionPlacement } from "../lib/badges";
import { isBirthdayToday } from "../lib/birthday";
import { getTier, getNextTier } from "../lib/tiers";
import { getCurrentSeason, getTrackedSeasons } from "../lib/seasons";
import type { Season } from "../lib/seasons";
import type { EventRow, PlayerMatchHistoryRow, PlayerStatus } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const NAVY = "#0f2547";
const ORANGE_BAND = "rgba(255, 122, 26, 0.14)";
const BADGE_PAGE_SIZE = 6;

type XAxisMode = "games" | "date";

interface SeasonHistoryEntry {
  season: Season;
  rank: number;
  rating: number;
  games: number;
  wins: number;
  ratingGain: number;
}

interface ViewerMatchRow {
  team_a_player_1_id: string;
  team_a_player_2_id: string;
  team_b_player_1_id: string;
  team_b_player_2_id: string;
  team_a_score: number;
  team_b_score: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Dashboard({
  playerId,
  isOwnProfile = false,
  viewerId,
  onViewEvents,
}: {
  playerId: string;
  // The full opponent-by-opponent head-to-head breakdown and the "share my
  // card" action are only shown on your own dashboard — not when viewing a
  // clubmate's, via the leaderboard click-through. Keeps that full
  // breakdown purely self-reflective rather than something people can
  // browse to see how a clubmate stacks up against everyone else, per
  // Ben's "no unnecessary gloating or unfairness" note (2026-08-04).
  isOwnProfile?: boolean;
  // The signed-in user's own player id — only needed (and only used) when
  // viewing someone else's dashboard, to show "your own record against
  // this specific person" (added 2026-08-14). Unlike the full breakdown
  // above, this is about the viewer's own relationship with this one
  // player, not exposing the viewed player's data, so it's fine to show
  // on a clubmate's profile.
  viewerId?: string;
  // Lets the "next event" block jump to the Events tab — only wired up on
  // your own dashboard, same as above.
  onViewEvents?: () => void;
}) {
  const [player, setPlayer] = useState<PlayerStatus | null>(null);
  const [history, setHistory] = useState<PlayerMatchHistoryRow[]>([]);
  const [monthlyFinishes, setMonthlyFinishes] = useState<MonthlyFinish[]>([]);
  // Competition placements (1st/2nd) this player's team earned — feeds the
  // Competition winner/runner-up badges. Added 2026-08-27.
  const [competitionPlacements, setCompetitionPlacements] = useState<CompetitionPlacement[]>([]);
  const [nextEvent, setNextEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [xAxis, setXAxis] = useState<XAxisMode>("games");
  const [showShareCard, setShowShareCard] = useState(false);
  // The badge grid's tooltip previously relied on the native `title`
  // attribute, which only shows on desktop hover — silent on a phone,
  // which is how most people actually use this. Tapping a badge now
  // toggles it "selected" and shows its description below the grid
  // instead, which works identically for a tap or a click. Added
  // 2026-08-11 at Ben's request.
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
  // Keeps the badges card from growing unbounded as someone racks up more
  // and more of them — shows the first 6 (most recently earned first) with
  // a "Show more" toggle beneath. Added 2026-08-13 at Ben's request.
  const [showAllBadges, setShowAllBadges] = useState(false);
  // Raw match rows involving the viewer — only fetched when looking at a
  // clubmate's dashboard, to compute "your record vs this specific
  // player" below. Uses the `matches` table directly (not
  // player_match_history) because it needs real player ids on both teams
  // to match this one specific person regardless of who their partner was
  // in any given game — player_match_history only has opponent names.
  const [viewerMatches, setViewerMatches] = useState<ViewerMatchRow[]>([]);
  // Seasons — one row per tracked season this player was already
  // established (12+ games) for, fetched via the same live
  // get_season_standings() function the Leaderboard's season card uses.
  // Shown on any profile (own or a clubmate's), same as Personal Best /
  // Best Partner — it's about this player's own trajectory, not a
  // comparison against anyone specific.
  const trackedSeasons = useMemo(() => getTrackedSeasons(), []);
  const currentSeason = useMemo(() => getCurrentSeason(), []);
  const [seasonEntries, setSeasonEntries] = useState<SeasonHistoryEntry[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(trackedSeasons.length > 0);
  // Live overall leaderboard position — only fetched on your own profile
  // (same "own profile only" scoping as the share button itself), since
  // it's just for the share card below. Mirrors the Leaderboard page's own
  // ranking rule: sorted by current rating, provisional players excluded
  // (they're not ranked there either), so null here means either not
  // fetched yet or genuinely not-yet-ranked.
  const [leaderboardPosition, setLeaderboardPosition] = useState<{ rank: number; totalRanked: number } | null>(
    null
  );

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

    supabase
      .from("monthly_leaderboard_snapshots")
      .select("year_month, rank")
      .eq("player_id", playerId)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setMonthlyFinishes(
          (data ?? []).map((r) => ({ yearMonth: r.year_month as string, rank: r.rank as number }))
        );
      });

    // Competition winner/runner-up badges — find every team this player
    // was on, then any 1st/2nd place result for those teams. Two steps
    // (rather than one join) since competition_teams doesn't have a
    // single "player_id" column to filter on directly — a player could be
    // either player1 or player2 on a team.
    supabase
      .from("competition_teams")
      .select("id")
      .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
      .then(({ data: teamRows, error: teamsError }) => {
        if (cancelled || teamsError || !teamRows || teamRows.length === 0) return;
        const teamIds = teamRows.map((t) => t.id as string);
        supabase
          .from("competition_results")
          .select("placement, created_at, competitions(name)")
          .in("team_id", teamIds)
          .in("placement", [1, 2])
          .then(({ data: resultRows, error: resultsError }) => {
            if (cancelled || resultsError || !resultRows) return;
            setCompetitionPlacements(
              resultRows
                .filter((r) => r.competitions)
                .map((r) => ({
                  placement: r.placement as 1 | 2,
                  competitionName: (r.competitions as unknown as { name: string }).name,
                  achievedAt: r.created_at as string,
                }))
            );
          });
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    if (isOwnProfile || !viewerId) {
      setViewerMatches([]);
      return;
    }
    supabase
      .from("matches")
      .select("team_a_player_1_id, team_a_player_2_id, team_b_player_1_id, team_b_player_2_id, team_a_score, team_b_score")
      .eq("status", "confirmed")
      .or(
        `team_a_player_1_id.eq.${viewerId},team_a_player_2_id.eq.${viewerId},team_b_player_1_id.eq.${viewerId},team_b_player_2_id.eq.${viewerId}`
      )
      .then(({ data, error }) => {
        if (!error) setViewerMatches((data ?? []) as ViewerMatchRow[]);
      });
  }, [isOwnProfile, viewerId]);

  useEffect(() => {
    if (trackedSeasons.length === 0) {
      setSeasonEntries([]);
      return;
    }
    let cancelled = false;
    setSeasonLoading(true);
    Promise.all(
      trackedSeasons.map((season) => {
        const isCurrent = season.key === currentSeason.key;
        const asOf = isCurrent ? new Date() : new Date(season.nextStart.getTime() - 1000);
        return supabase
          .rpc("get_season_standings", { p_season_start: season.start.toISOString(), p_as_of: asOf.toISOString() })
          .then(({ data, error }) => {
            if (error || !data) return null;
            const row = (
              data as { player_id: string; rank: number; rating: number; games: number; wins: number; rating_gain: number }[]
            ).find((r) => r.player_id === playerId);
            if (!row) return null;
            const entry: SeasonHistoryEntry = {
              season,
              rank: row.rank,
              rating: row.rating,
              games: row.games,
              wins: row.wins,
              ratingGain: row.rating_gain,
            };
            return entry;
          });
      })
    ).then((results) => {
      if (cancelled) return;
      setSeasonEntries(results.filter((r): r is SeasonHistoryEntry => !!r));
      setSeasonLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [trackedSeasons, currentSeason, playerId]);

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

  useEffect(() => {
    if (!isOwnProfile) return;
    supabase
      .from("player_status")
      .select("id, rating, is_provisional")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (error || !data) return;
        const ranked = (data as { id: string; rating: number; is_provisional: boolean }[])
          .filter((p) => !p.is_provisional)
          .sort((a, b) => b.rating - a.rating);
        const idx = ranked.findIndex((p) => p.id === playerId);
        setLeaderboardPosition(idx === -1 ? null : { rank: idx + 1, totalRanked: ranked.length });
      });
  }, [isOwnProfile, playerId]);

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

  const badges = useMemo(() => {
    const computed = computeBadges(
      history,
      player?.games_played ?? 0,
      player?.date_joined ?? "",
      monthlyFinishes,
      competitionPlacements
    );
    // Most recently earned first — badges with no known date (shouldn't
    // happen in practice) sort to the end rather than the top.
    return [...computed].sort((a, b) => {
      if (!a.achievedAt && !b.achievedAt) return 0;
      if (!a.achievedAt) return 1;
      if (!b.achievedAt) return -1;
      return new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
    });
  }, [history, player, monthlyFinishes, competitionPlacements]);

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

  // The partner you've won the most games with — added 2026-08-11 at
  // Ben's request, shown beneath the rating graph. Same grouping approach
  // as head-to-head below (a 2v2 team's "teammate" isn't split into
  // individual credit), but this one's purely complimentary (it's about
  // who to team up with again, not anyone's record against you), so
  // unlike head-to-head it isn't restricted to your own profile.
  const bestPartner = useMemo(() => {
    const winsByPartner = new Map<string, number>();
    for (const h of history) {
      if (h.won) winsByPartner.set(h.teammate_name, (winsByPartner.get(h.teammate_name) ?? 0) + 1);
    }
    let name: string | null = null;
    let wins = 0;
    for (const [n, w] of winsByPartner) {
      if (w > wins) {
        name = n;
        wins = w;
      }
    }
    return name ? { name, wins } : null;
  }, [history]);

  // Best win of your career so far — the highest-rated opponent pairing
  // you've beaten. Uses each match's lower-rated opponent as the yardstick
  // (the same "at least this good" proxy the Bracket Buster badge already
  // uses), since that's the only opponent-strength figure captured per
  // match — no extra query needed, `history` already has it. Shown on the
  // share card as a highlight-reel stat.
  const highestWin = useMemo(() => {
    let best: PlayerMatchHistoryRow | null = null;
    for (const h of history) {
      if (!h.won || h.opponent_min_pre_rating == null) continue;
      if (!best || h.opponent_min_pre_rating > (best.opponent_min_pre_rating ?? -Infinity)) best = h;
    }
    return best ? { opponentNames: best.opponent_names, opponentRating: Math.round(best.opponent_min_pre_rating!) } : null;
  }, [history]);

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

  // The calendar month with the most wins — ties go to the more recent
  // month. Wins only (not win %), so it stays a simple, upbeat "your best
  // stretch" fact rather than another ranking to game.
  const bestMonth = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const h of history) {
      if (!h.won) continue;
      const d = new Date(h.played_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    let bestKey: string | null = null;
    let bestWins = 0;
    for (const [key, wins] of byMonth) {
      if (wins > bestWins || (wins === bestWins && (!bestKey || key > bestKey))) {
        bestKey = key;
        bestWins = wins;
      }
    }
    if (!bestKey) return null;
    const [y, m] = bestKey.split("-").map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return { label, wins: bestWins };
  }, [history]);

  // Longest winning streak ever, not just the currently active one (that's
  // what Club Stats shows across the whole club) — `history` is already
  // ordered oldest-first by game_number, so a single forward pass works.
  const longestStreak = useMemo(() => {
    let best = 0;
    let current = 0;
    for (const h of history) {
      if (h.won) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
    return best;
  }, [history]);

  const currentSeasonEntry = seasonEntries.find((e) => e.season.key === currentSeason.key) ?? null;
  const pastSeasonEntries = [...seasonEntries]
    .filter((e) => e.season.key !== currentSeason.key)
    .sort((a, b) => b.season.start.getTime() - a.season.start.getTime());
  // Positive-only, and only from seasons that have actually finished —
  // the current season's rank/gain can still move, so it wouldn't really
  // be a "best" yet.
  const bestRankEntry =
    pastSeasonEntries.length > 0
      ? pastSeasonEntries.reduce((best, e) => (e.rank < best.rank ? e : best))
      : null;
  const bestGainEntry =
    pastSeasonEntries.length > 0
      ? pastSeasonEntries.reduce((best, e) => (e.ratingGain > best.ratingGain ? e : best))
      : null;

  // Your own record against this one specific player, regardless of who
  // either of you partnered with in any given match — only computed when
  // viewing someone else's dashboard. Matches where you were teammates
  // (rather than opponents), or that don't involve the viewed player at
  // all, are skipped.
  const headToHeadVsViewed = useMemo(() => {
    if (isOwnProfile || !viewerId) return null;
    let wins = 0;
    let losses = 0;
    for (const m of viewerMatches) {
      const viewerOnA = m.team_a_player_1_id === viewerId || m.team_a_player_2_id === viewerId;
      const viewerOnB = m.team_b_player_1_id === viewerId || m.team_b_player_2_id === viewerId;
      const viewedOnA = m.team_a_player_1_id === playerId || m.team_a_player_2_id === playerId;
      const viewedOnB = m.team_b_player_1_id === playerId || m.team_b_player_2_id === playerId;
      if (viewerOnA && viewedOnB) {
        if (m.team_a_score > m.team_b_score) wins++;
        else losses++;
      } else if (viewerOnB && viewedOnA) {
        if (m.team_b_score > m.team_a_score) wins++;
        else losses++;
      }
    }
    return wins + losses > 0 ? { wins, losses } : null;
  }, [viewerMatches, viewerId, playerId, isOwnProfile]);

  if (loading) return <p>Loading your dashboard…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!player) return <p className="error">Couldn't find your player profile.</p>;

  const lastDelta = history.length > 0 ? history[history.length - 1].rating_delta : null;
  // Trimmed from 8 to 5 at Ben's request (2026-08-11) — Game history is
  // there for the full list; this is just a quick recent-form snapshot.
  const recent = [...history].reverse().slice(0, 5);
  const tier = getTier(player.games_played);
  const nextTier = getNextTier(player.games_played);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={player.display_name} url={player.avatar_url} size={55} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="player-name-tag">
              {player.display_name}
              {(isOwnProfile || player.date_of_birth_visible) && isBirthdayToday(player.date_of_birth) && (
                <span title="Happy birthday!" style={{ marginLeft: 6 }}>
                  🎂
                </span>
              )}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span className={`badge ${tier.className}`} title={`${player.games_played} games played`}>
                {tier.label}
              </span>
              {player.role_title && <span className="badge badge-role">{player.role_title}</span>}
            </div>
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
          {nextTier && ` · ${nextTier.gamesToGo} more to become a ${nextTier.tier.label}`}
        </p>
        {isOwnProfile && (
          <button
            onClick={() => setShowShareCard(true)}
            style={{ background: "var(--navy-active)" }}
          >
            Share my card
          </button>
        )}
      </div>

      {isOwnProfile && nextEvent && (
        <div className="card next-event-card" onClick={onViewEvents} style={{ cursor: onViewEvents ? "pointer" : "default" }}>
          <p className="stat-meta" style={{ marginTop: 0, marginBottom: 4, color: "var(--orange-600)", fontWeight: 700 }}>
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

      {badges.length > 0 && (
        <div className="card">
          <h2>Badges</h2>
          <div className="badge-grid">
            {(showAllBadges ? badges : badges.slice(0, BADGE_PAGE_SIZE)).map((b) => (
              <div
                className={`badge-tile${selectedBadgeId === b.id ? " badge-tile-selected" : ""}`}
                key={b.id}
                title={b.description}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedBadgeId((id) => (id === b.id ? null : b.id))}
              >
                <span className="badge-tile-emoji">{b.emoji}</span>
                <span className="badge-tile-label">{b.label}</span>
              </div>
            ))}
          </div>
          {selectedBadgeId && (
            <p className="stat-meta badge-description" style={{ marginBottom: 0 }}>
              {badges.find((b) => b.id === selectedBadgeId)?.description}
            </p>
          )}
          {badges.length > BADGE_PAGE_SIZE && (
            <button
              onClick={() => {
                setShowAllBadges((v) => !v);
                setSelectedBadgeId(null);
              }}
              style={{
                marginTop: 12,
                background: "transparent",
                color: "var(--navy-500)",
                border: "1px solid var(--border)",
              }}
            >
              {showAllBadges ? "Show less" : `Show more (${badges.length - BADGE_PAGE_SIZE} more)`}
            </button>
          )}
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
        {bestPartner && (
          <p className="stat-meta" style={{ marginTop: 8, marginBottom: 0 }}>
            Best partner: <strong style={{ color: "var(--navy-900)" }}>{bestPartner.name}</strong> — {bestPartner.wins}{" "}
            win{bestPartner.wins === 1 ? "" : "s"} together
          </p>
        )}
      </div>

      {(bestMonth || longestStreak >= 2) && (
        <div className="card">
          <h2>Highlights</h2>
          {bestMonth && (
            <div className="match-row">
              <div>
                <div className="opponent">Best month</div>
                <div className="meta">{bestMonth.label}</div>
              </div>
              <div className="score">
                {bestMonth.wins} win{bestMonth.wins === 1 ? "" : "s"}
              </div>
            </div>
          )}
          {longestStreak >= 2 && (
            <div className="match-row">
              <div className="opponent">Longest winning streak</div>
              <div className="score">
                {longestStreak} game{longestStreak === 1 ? "" : "s"}
              </div>
            </div>
          )}
        </div>
      )}

      {trackedSeasons.length === 0 ? (
        <div className="card">
          <h2>Season</h2>
          <p className="stat-meta" style={{ marginBottom: 0 }}>
            Seasons kick off with Autumn on 1 September.
          </p>
        </div>
      ) : (
        <div className="card">
          <h2>{currentSeason.label}</h2>
          {seasonLoading ? (
            <p className="stat-meta">Loading…</p>
          ) : currentSeasonEntry ? (
            <div className="match-row">
              <div>
                <div className="opponent">This season</div>
                <div className="meta">
                  {currentSeasonEntry.games} game{currentSeasonEntry.games === 1 ? "" : "s"} ·{" "}
                  {currentSeasonEntry.games > 0
                    ? Math.round((currentSeasonEntry.wins / currentSeasonEntry.games) * 100)
                    : 0}
                  % wins
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="score">#{currentSeasonEntry.rank}</div>
                <div
                  className={
                    currentSeasonEntry.ratingGain > 0
                      ? "delta-positive"
                      : currentSeasonEntry.ratingGain < 0
                      ? "delta-negative"
                      : "delta-neutral"
                  }
                  style={{ fontSize: "0.78rem" }}
                >
                  {currentSeasonEntry.ratingGain > 0 ? "+" : ""}
                  {Math.round(currentSeasonEntry.ratingGain)}
                </div>
              </div>
            </div>
          ) : (
            <p className="stat-meta">Not yet established (12+ games) this season.</p>
          )}

          {pastSeasonEntries.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Season history</h2>
              {pastSeasonEntries.map((e) => (
                <div className="match-row" key={e.season.key}>
                  <div>
                    <div className="opponent">{e.season.label}</div>
                    <div className="meta">
                      {e.games} games · {e.ratingGain > 0 ? "+" : ""}
                      {Math.round(e.ratingGain)} rating
                    </div>
                  </div>
                  <div className="score">#{e.rank}</div>
                </div>
              ))}
            </>
          )}

          {(bestRankEntry || (bestGainEntry && bestGainEntry.ratingGain > 0)) && (
            <>
              <h2 style={{ marginTop: 16 }}>Personal bests</h2>
              {bestRankEntry && (
                <p className="stat-meta" style={{ marginBottom: 4 }}>
                  Best finish: <strong style={{ color: "var(--navy-900)" }}>#{bestRankEntry.rank}</strong> (
                  {bestRankEntry.season.label})
                </p>
              )}
              {bestGainEntry && bestGainEntry.ratingGain > 0 && (
                <p className="stat-meta" style={{ marginBottom: 0 }}>
                  Best season gain:{" "}
                  <strong style={{ color: "var(--navy-900)" }}>+{Math.round(bestGainEntry.ratingGain)}</strong> (
                  {bestGainEntry.season.label})
                </p>
              )}
            </>
          )}
        </div>
      )}

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

      {!isOwnProfile && viewerId && (
        <div className="card">
          <h2>Head-to-head</h2>
          {headToHeadVsViewed ? (
            <div className="match-row">
              <div className="opponent">You vs {player.display_name}</div>
              <div className="score">
                {headToHeadVsViewed.wins}–{headToHeadVsViewed.losses}
              </div>
            </div>
          ) : (
            <p className="stat-meta">You haven't played {player.display_name} yet.</p>
          )}
        </div>
      )}

      {isOwnProfile && showShareCard && (
        <ShareCard
          player={player}
          badges={badges}
          bestPartner={bestPartner}
          highestWin={highestWin}
          leaderboardPosition={leaderboardPosition}
          onClose={() => setShowShareCard(false)}
        />
      )}
    </div>
  );
}
