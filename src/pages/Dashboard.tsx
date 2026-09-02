import { useEffect, useMemo, useRef, useState } from "react";
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
import SeasonWrappedCard from "../components/SeasonWrappedCard";
import { computeBadges, getFrameTier } from "../lib/badges";
import type { MonthlyFinish, CompetitionPlacement, SeasonTop10Finish, FrameTier } from "../lib/badges";
import { fireConfetti, fireBalloons } from "../lib/confetti";
import { useToast } from "../components/Toast";
import { computeSeasonWrappedStats } from "../lib/seasonWrapped";
import type { SeasonWrappedStats } from "../lib/seasonWrappedImage";
import { isBirthdayToday } from "../lib/birthday";
import { getTier, getNextTier } from "../lib/tiers";
import { getCurrentSeason, getTrackedSeasons } from "../lib/seasons";
import { getEventForecast } from "../lib/weather";
import type { EventForecast } from "../lib/weather";
import type { Season } from "../lib/seasons";
import type { EventRow, LegacyBadgeRow, PlayerMatchHistoryRow, PlayerStatus } from "../types";
import PageLoading from "../components/PageLoading";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const NAVY = "#0f2547";
const ORANGE_BAND = "rgba(255, 122, 26, 0.14)";
// Dark-mode equivalents (2026-09-01, Ben: "the bar chart in dark mode
// isn't very visible") — the light-mode colors above were hardcoded into
// the chart's canvas draw calls, which don't pick up index.css's
// [data-theme="dark"] variable overrides the way regular DOM elements do.
// NAVY (near-black) was nearly invisible against the dark theme's own
// near-black background, and the same low-opacity orange band read as a
// muddy smear instead of a clean wash. Picked to match the dark theme's
// existing palette: the rating line uses --text's dark value so it pops
// against the dark background, the band opacity is bumped up so it still
// reads clearly, and grid/ticks reuse dark --border/--text-muted.
const NAVY_DARK = "#e7ecf5";
const ORANGE_BAND_DARK = "rgba(255, 122, 26, 0.28)";
const GRID_LIGHT = "#eef1f6";
const GRID_DARK = "#262f3d";
const TICKS_LIGHT = "#667085";
const TICKS_DARK = "#8b96a5";
const BADGE_PAGE_SIZE = 6;
const RECENT_MATCHES_PAGE_SIZE = 5;
const HEAD_TO_HEAD_PAGE_SIZE = 5;

// Tracks the app's dark/light theme (see App.tsx — a data-theme attribute
// on <html>, driven by the signed-in viewer's own saved preference) so the
// canvas-drawn chart below can pick matching colors. Regular DOM elements
// pick this up automatically via CSS variables; Chart.js can't, since it
// draws to a canvas rather than styled HTML, so this mirrors the attribute
// into React state via a MutationObserver.
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute("data-theme") === "dark"
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

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

// Small "weather today" widget (2026-08-29, Ben's request) — same
// Open-Meteo/venue-forecast plumbing as the Events page's per-event
// WeatherPill (lib/weather.ts), just always for today rather than tied to
// a specific event's own weather_enabled toggle. Renders nothing while
// loading or if a forecast genuinely isn't available, so it never leaves a
// half-finished-looking gap on the dashboard.
function TodayWeatherCard() {
  const [forecast, setForecast] = useState<EventForecast | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const todayStr = new Date().toISOString().slice(0, 10);
    getEventForecast(todayStr, null).then((f) => {
      if (!cancelled) setForecast(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!forecast) return null;

  return (
    <div className="card">
      <p className="stat-meta" style={{ marginTop: 0, marginBottom: 4, color: "var(--sky-600)", fontWeight: 700 }}>
        Weather today
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "1.6rem", fontWeight: 800 }}>
          {forecast.emoji} {forecast.tempC}°C
        </span>
        <span className="stat-meta" style={{ margin: 0 }}>
          {forecast.description}
          {forecast.precipitationChance != null && forecast.precipitationChance >= 30
            ? ` · ${forecast.precipitationChance}% chance of rain`
            : ""}
        </span>
      </div>
    </div>
  );
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
  const isDarkTheme = useIsDarkTheme();
  const toast = useToast();
  const [player, setPlayer] = useState<PlayerStatus | null>(null);
  const [history, setHistory] = useState<PlayerMatchHistoryRow[]>([]);
  const [monthlyFinishes, setMonthlyFinishes] = useState<MonthlyFinish[]>([]);
  // Competition placements (1st/2nd) this player's team earned — feeds the
  // Competition winner/runner-up badges. Added 2026-08-27.
  const [competitionPlacements, setCompetitionPlacements] = useState<CompetitionPlacement[]>([]);
  // Admin-granted legacy badges (2026-08-28) — see legacy_badges migration.
  // Merged alongside the computed badges below, not part of computeBadges()
  // itself, since these are the one manually-entered exception rather than
  // derived from match/competition data.
  const [legacyBadges, setLegacyBadges] = useState<LegacyBadgeRow[]>([]);
  const [nextEvent, setNextEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [xAxis, setXAxis] = useState<XAxisMode>("games");
  const [showShareCard, setShowShareCard] = useState(false);
  // Season Wrapped (2026-08-28) — which past season's recap card is
  // currently open, if any. Only ever set on your own dashboard (see the
  // "Wrapped" link next to each season-history row below).
  const [wrappedSeasonKey, setWrappedSeasonKey] = useState<string | null>(null);
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
  // Same "show more" pattern for Recent matches and Head-to-head, both of
  // which used to hard-cut at 5 with no way to see more. Added 2026-09-02
  // at Ben's request.
  const [visibleRecentCount, setVisibleRecentCount] = useState(RECENT_MATCHES_PAGE_SIZE);
  const [visibleH2HCount, setVisibleH2HCount] = useState(HEAD_TO_HEAD_PAGE_SIZE);
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

    supabase
      .from("legacy_badges")
      .select("*")
      .eq("player_id", playerId)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setLegacyBadges((data ?? []) as LegacyBadgeRow[]);
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

    const lineColor = isDarkTheme ? NAVY_DARK : NAVY;
    const bandColor = isDarkTheme ? ORANGE_BAND_DARK : ORANGE_BAND;

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
          backgroundColor: bandColor,
          fill: "-1" as const,
        },
        {
          label: "Rating",
          data: rating,
          borderColor: lineColor,
          backgroundColor: lineColor,
          pointRadius: history.length > 40 ? 0 : 3,
          borderWidth: 2.5,
          tension: 0.25,
          fill: false,
        },
      ],
    };
  }, [player, history, xAxis, isDarkTheme]);

  // Seasonal Top 10 badges — derived from seasonEntries (already fetched
  // live above for the Seasons history card), filtered to seasons that
  // have actually finished (excludes the current in-progress one, whose
  // rank can still change) and to Top 10 finishes only. Added 2026-08-28.
  const seasonTop10Finishes = useMemo<SeasonTop10Finish[]>(
    () =>
      seasonEntries
        .filter((e) => e.season.key !== currentSeason.key && e.rank <= 10)
        .map((e) => ({
          seasonName: e.season.name,
          label: e.season.label,
          achievedAt: e.season.nextStart.toISOString(),
        })),
    [seasonEntries, currentSeason]
  );

  const badges = useMemo(() => {
    const computed = computeBadges(
      history,
      player?.games_played ?? 0,
      player?.date_joined ?? "",
      monthlyFinishes,
      competitionPlacements,
      seasonTop10Finishes
    );
    // Admin-granted legacy badges (2026-08-28) merged in alongside the
    // computed set — see legacy_badges migration for why these exist.
    const legacy = legacyBadges.map((b) => ({
      id: `legacy-${b.id}`,
      emoji: b.emoji,
      label: b.label,
      description: b.description,
      achievedAt: b.achieved_at,
    }));
    // Most recently earned first — badges with no known date (shouldn't
    // happen in practice) sort to the end rather than the top.
    return [...computed, ...legacy].sort((a, b) => {
      if (!a.achievedAt && !b.achievedAt) return 0;
      if (!a.achievedAt) return 1;
      if (!b.achievedAt) return -1;
      return new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime();
    });
  }, [history, player, monthlyFinishes, competitionPlacements, seasonTop10Finishes, legacyBadges]);

  // Cosmetic avatar frame — purely decorative, visible to anyone viewing
  // this profile (not a self-facing preference like hide_own_rating).
  const frameTier = useMemo(() => getFrameTier(badges.length), [badges]);

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

  // Rolling count-up animation for the rating number (2026-09-02, Ben's
  // request — part of the same "fun stuff" batch as the confetti below).
  // Dashboard fetches fresh on every mount, so there's no in-memory "old"
  // value to tween from — instead the last-shown rating is persisted per
  // player in localStorage, and if it differs from the freshly loaded
  // rating we animate from old to new over ~900ms rather than just
  // snapping straight to the new number. Own profile only: for someone
  // else's profile there's no meaningful "since you last looked" baseline.
  const [displayedRating, setDisplayedRating] = useState<number | null>(null);
  const ratingAnimFrame = useRef<number | null>(null);
  useEffect(() => {
    if (!isOwnProfile || loading || !player) return;
    const key = `sideline_last_rating_${player.id}`;
    const current = Math.round(player.rating);
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      stored = raw !== null ? parseInt(raw, 10) : null;
    } catch {
      stored = null;
    }

    if (stored === null || stored === current || Number.isNaN(stored)) {
      setDisplayedRating(current);
    } else {
      const from = stored;
      const to = current;
      const durationMs = 900;
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayedRating(Math.round(from + (to - from) * eased));
        if (progress < 1) {
          ratingAnimFrame.current = requestAnimationFrame(tick);
        }
      };
      ratingAnimFrame.current = requestAnimationFrame(tick);
    }

    try {
      localStorage.setItem(key, String(current));
    } catch {
      // ignore — non-critical
    }

    return () => {
      if (ratingAnimFrame.current !== null) cancelAnimationFrame(ratingAnimFrame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnProfile, loading, player?.id, player?.rating]);

  // Confetti + toast the first time you see a new badge, frame tier, tier
  // promotion, or personal best on your OWN dashboard (2026-09-02, Ben's
  // request). All four are recomputed fresh every render, so "new" is
  // tracked client-side via a per-player localStorage snapshot of what's
  // already been seen. First-ever load just seeds the snapshot silently —
  // nobody with 15 existing badges should get 15 confetti bursts the
  // moment this feature ships. Only genuinely new achievements after that
  // baseline fire anything. Deliberately skipped when browsing someone
  // else's profile (isOwnProfile false) — this is a celebration for the
  // account owner, not something to trigger by looking at others.
  //
  // At most one confetti burst fires per visit even if several things
  // happened at once (richest achievement wins: frame > tier > personal
  // best > badge) so it doesn't turn into a chaotic pile-up — but every
  // achievement still gets its own toast, since the toast stack already
  // handles multiple messages fine.
  useEffect(() => {
    if (!isOwnProfile || loading || !player) return;

    const seenBadgesKey = `sideline_seen_badges_${player.id}`;
    const seenFrameKey = `sideline_seen_frame_${player.id}`;
    const seenTierKey = `sideline_seen_tier_${player.id}`;
    const seenBestKey = `sideline_seen_best_${player.id}`;

    let seenBadgeIds: string[] | null = null;
    try {
      const raw = localStorage.getItem(seenBadgesKey);
      seenBadgeIds = raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      seenBadgeIds = null;
    }
    const seenFrame = localStorage.getItem(seenFrameKey) as FrameTier | "none" | null;
    const seenTier = localStorage.getItem(seenTierKey);
    const seenBestRaw = localStorage.getItem(seenBestKey);
    const seenBest = seenBestRaw !== null ? Number(seenBestRaw) : null;

    const currentBadgeIds = badges.map((b) => b.id);
    const currentTierLabel = getTier(player.games_played).label;
    const currentBest = Math.round(personalBest.rating);
    const isFirstRun = seenBadgeIds === null;

    if (!isFirstRun) {
      const newlyEarned = badges.filter((b) => !seenBadgeIds!.includes(b.id));
      const frameUpgraded = seenFrame !== null && seenFrame !== (frameTier ?? "none") && frameTier !== null;
      const tierPromoted = seenTier !== null && seenTier !== currentTierLabel;
      const newPersonalBest = seenBest !== null && !Number.isNaN(seenBest) && currentBest > seenBest;

      if (frameUpgraded) {
        fireConfetti({ shape: "pickleball", pieceCount: 220 });
      } else if (tierPromoted) {
        fireConfetti();
      } else if (newPersonalBest) {
        fireConfetti({ pieceCount: 90 });
      } else if (newlyEarned.length > 0) {
        fireConfetti();
      }

      if (frameUpgraded) {
        toast.success(`New avatar frame unlocked: ${frameTier![0].toUpperCase()}${frameTier!.slice(1)}!`);
      }
      if (tierPromoted) {
        toast.success(`Promoted to ${currentTierLabel}!`);
      }
      if (newPersonalBest) {
        toast.success(`New personal best: ${currentBest}!`);
      }
      if (newlyEarned.length > 0) {
        toast.success(
          newlyEarned.length === 1
            ? `New badge earned: ${newlyEarned[0].emoji} ${newlyEarned[0].label}!`
            : `${newlyEarned.length} new badges earned!`
        );
      }
    }

    try {
      localStorage.setItem(seenBadgesKey, JSON.stringify(currentBadgeIds));
      localStorage.setItem(seenFrameKey, frameTier ?? "none");
      localStorage.setItem(seenTierKey, currentTierLabel);
      localStorage.setItem(seenBestKey, String(currentBest));
    } catch {
      // Storage full/unavailable (e.g. private browsing) — non-critical,
      // worst case is a repeated celebration next visit.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnProfile, loading, player, badges, frameTier, personalBest]);

  // Birthday balloons (2026-09-02) — once per calendar day, on your own
  // dashboard, on your actual birthday. Separate localStorage key per day
  // (rather than reusing the achievement-tracking pattern above) since
  // this needs to re-fire every year, not just once ever.
  useEffect(() => {
    if (!isOwnProfile || loading || !player) return;
    if (!isBirthdayToday(player.date_of_birth)) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const seenKey = `sideline_birthday_shown_${player.id}_${todayKey}`;
    if (localStorage.getItem(seenKey)) return;
    fireBalloons();
    try {
      localStorage.setItem(seenKey, "1");
    } catch {
      // ignore — non-critical
    }
  }, [isOwnProfile, loading, player]);

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

  // Season Wrapped stats for whichever past season's card is currently
  // open — computed on demand rather than for every past season up front,
  // since it's just a lookup-and-crunch over data already in memory
  // (history + badges) once wrappedSeasonKey is set.
  const wrappedStats: SeasonWrappedStats | null = useMemo(() => {
    if (!wrappedSeasonKey) return null;
    const entry = pastSeasonEntries.find((e) => e.season.key === wrappedSeasonKey);
    if (!entry) return null;
    return computeSeasonWrappedStats(
      entry.season,
      { games: entry.games, wins: entry.wins, rank: entry.rank, ratingGain: entry.ratingGain, endRating: entry.rating },
      history,
      badges
    );
  }, [wrappedSeasonKey, pastSeasonEntries, history, badges]);

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

  if (loading) return <PageLoading label="Loading your dashboard…" />;
  if (error) return <p className="error">{error}</p>;
  if (!player) return <p className="error">Couldn't find your player profile.</p>;

  const lastDelta = history.length > 0 ? history[history.length - 1].rating_delta : null;
  // Trimmed from 8 to 5 at Ben's request (2026-08-11) — Game history is
  // there for the full list; this is just a quick recent-form snapshot.
  // Starts at 5 with a "Show more" button (added 2026-09-02) rather than a
  // hard cutoff, so it's still a snapshot by default but not a dead end.
  const recent = [...history].reverse();
  const tier = getTier(player.games_played);
  const nextTier = getNextTier(player.games_played);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={player.display_name} url={player.avatar_url} size={55} frameTier={frameTier} />
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
        {isOwnProfile && player.hide_own_rating ? (
          <p className="stat-meta" style={{ marginTop: 8 }}>
            You've hidden your rating number from your own dashboard — change this any time in My Account.
          </p>
        ) : (
          <div className="stat-hero">
            <span className="value">{displayedRating ?? Math.round(player.rating)}</span>
            {lastDelta !== null && (
              <span className={lastDelta > 0 ? "delta-positive" : lastDelta < 0 ? "delta-negative" : "delta-neutral"}>
                {lastDelta > 0 ? "▲" : lastDelta < 0 ? "▼" : "–"} {Math.abs(Math.round(lastDelta))} since last game
              </span>
            )}
          </div>
        )}
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

      {isOwnProfile && <TodayWeatherCard />}

      {/* Partner-finder widget ("Looking for a game?") temporarily switched
          off, 2026-08-28, at Ben's request — code/DB tables left in place
          (see PartnerFinderCard.tsx, 0051_add_partner_requests.sql) so it
          can be turned back on later by re-adding the import + this line. */}

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

      {isOwnProfile && player.hide_own_rating ? (
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>Rating history</h2>
          <p className="stat-meta" style={{ marginTop: 0 }}>
            You've hidden your rating number from your own dashboard — change this any time in My Account.
          </p>
          {bestPartner && (
            <p className="stat-meta" style={{ marginTop: 8, marginBottom: 0 }}>
              Best partner: <strong style={{ color: "var(--heading)" }}>{bestPartner.name}</strong> — {bestPartner.wins}{" "}
              win{bestPartner.wins === 1 ? "" : "s"} together
            </p>
          )}
        </div>
      ) : (
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
              <span style={{ fontWeight: 700, color: "var(--heading)" }}>
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
                    x: {
                      grid: { display: false },
                      ticks: { maxTicksLimit: 6, color: isDarkTheme ? TICKS_DARK : TICKS_LIGHT },
                    },
                    y: {
                      grid: { color: isDarkTheme ? GRID_DARK : GRID_LIGHT },
                      ticks: { color: isDarkTheme ? TICKS_DARK : TICKS_LIGHT },
                    },
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
              Best partner: <strong style={{ color: "var(--heading)" }}>{bestPartner.name}</strong> — {bestPartner.wins}{" "}
              win{bestPartner.wins === 1 ? "" : "s"} together
            </p>
          )}
        </div>
      )}

      {(history.length > 0 || bestMonth || longestStreak >= 2) && (
        <div className="card">
          <h2>Highlights</h2>
          {history.length > 0 && !(isOwnProfile && player.hide_own_rating) && (
            <div className="match-row">
              <div>
                <div className="opponent">Career high</div>
                {personalBest.date && <div className="meta">{formatDate(personalBest.date)}</div>}
              </div>
              <div className="score">{Math.round(personalBest.rating)}</div>
            </div>
          )}
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
                  <div style={{ textAlign: "right" }}>
                    <div className="score">#{e.rank}</div>
                    {isOwnProfile && e.games > 0 && (
                      <span
                        className="link-action"
                        role="button"
                        tabIndex={0}
                        onClick={() => setWrappedSeasonKey(e.season.key)}
                        style={{ fontSize: "0.72rem" }}
                      >
                        Wrapped ✨
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {(bestRankEntry || (bestGainEntry && bestGainEntry.ratingGain > 0)) && (
            <>
              <h2 style={{ marginTop: 16 }}>Personal bests</h2>
              {bestRankEntry && (
                <p className="stat-meta" style={{ marginBottom: 4 }}>
                  Best finish: <strong style={{ color: "var(--heading)" }}>#{bestRankEntry.rank}</strong> (
                  {bestRankEntry.season.label})
                </p>
              )}
              {bestGainEntry && bestGainEntry.ratingGain > 0 && (
                <p className="stat-meta" style={{ marginBottom: 0 }}>
                  Best season gain:{" "}
                  <strong style={{ color: "var(--heading)" }}>+{Math.round(bestGainEntry.ratingGain)}</strong> (
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
        {recent.slice(0, visibleRecentCount).map((m) => (
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
        {recent.length > visibleRecentCount && (
          <button
            onClick={() => setVisibleRecentCount((n) => n + RECENT_MATCHES_PAGE_SIZE)}
            style={{
              marginTop: 12,
              background: "transparent",
              color: "var(--navy-500)",
              border: "1px solid var(--border)",
            }}
          >
            Show more ({recent.length - visibleRecentCount} more)
          </button>
        )}
      </div>

      {isOwnProfile && headToHead.length > 0 && (
        <div className="card">
          <h2>Head-to-head</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Only visible to you — your own record against clubmates you've played.
          </p>
          {headToHead.slice(0, visibleH2HCount).map((row) => (
            <div className="match-row" key={row.opponent}>
              <div className="opponent">{row.opponent}</div>
              <div className="score">
                {row.wins}–{row.losses}
              </div>
            </div>
          ))}
          {headToHead.length > visibleH2HCount && (
            <button
              onClick={() => setVisibleH2HCount((n) => n + HEAD_TO_HEAD_PAGE_SIZE)}
              style={{
                marginTop: 12,
                background: "transparent",
                color: "var(--navy-500)",
                border: "1px solid var(--border)",
              }}
            >
              Show more ({headToHead.length - visibleH2HCount} more)
            </button>
          )}
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

      {isOwnProfile && wrappedStats && (
        <SeasonWrappedCard player={player} stats={wrappedStats} onClose={() => setWrappedSeasonKey(null)} />
      )}
    </div>
  );
}
