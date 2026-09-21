import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import { ShowMoreLess } from "../components/ShowMoreLess";
import type { LeaderboardRow, QuarterlyCupRow, QuarterlyCupTeamRow, QuarterlyCupMatchRow } from "../types";
import { getCurrentSeason, getTrackedSeasons, getSeasonEndInfo } from "../lib/seasons";
import { computeGroupStandings } from "../lib/competitionStandings";
import PageLoading from "../components/PageLoading";

type SortMode = "rating" | "improved";

type QuarterlyCupWithData = {
  cup: QuarterlyCupRow;
  teams: QuarterlyCupTeamRow[];
  matches: (QuarterlyCupMatchRow & { matches: { team_a_score: number; team_b_score: number } | null })[];
};

// Orders multiple concurrent Quarterly Cups (2026-09-14, Ben's request —
// the club now runs a Men's and a Women's cup side by side) so Men's
// always sits above Women's/Ladies', regardless of which was created or
// updated more recently. Anything that doesn't mention a gender at all
// (e.g. a single mixed cup, same as before this feature) sorts after
// both, so the common single-cup case is unaffected.
function quarterlyCupSortRank(name: string): number {
  if (/wom(a|e)n|ladies/i.test(name)) return 1;
  if (/\bmen'?s?\b/i.test(name)) return 0;
  return 2;
}

// Keeps the list from growing unbounded as more members join (nearly 200
// at last count) — search narrows things down instantly, and each section
// only renders a page at a time with "show more" beneath it. Reduced from
// 20 to 15 (2026-09-07), then 15 to 10 (2026-09-14, Ben's request) for
// both the club leaderboard and the seasonal league standings below,
// which share this constant.
const PAGE_SIZE = 10;
// Smaller page size for the two "Still establishing" lists (2026-09-01,
// Ben's request) — revealing 10 more at a time once expanded.
const PROVISIONAL_PAGE_SIZE = 10;
// The "unplayed" list specifically starts smaller — just 5 — since it's
// typically longer and less interesting than "played" (everyone in it is
// sitting untouched at 1500, so there's less to scan for). Still reveals
// 10 more at a time past that (2026-09-02, Ben's request).
const PROVISIONAL_UNPLAYED_INITIAL = 5;
// "Played" also starts at just 5 now (2026-09-14, Ben's request) — used to
// start at the full PROVISIONAL_PAGE_SIZE (10). Reveals 10 more at a time
// past that, same as unplayed above.
const PROVISIONAL_PLAYED_INITIAL = 5;

// A win-percentage "winner" with only 1-2 games played this month isn't a
// meaningful comparison against someone who's played a dozen — this is
// the minimum games this month before a player is eligible for the
// Highest win % block. Doesn't apply to the other two blocks, since
// those are raw counts (no fluke risk from a tiny sample).
const MIN_GAMES_FOR_WIN_PCT = 3;

// Club Player needs a fuller month's picture than the win-% block above —
// Ben's club typically plays ~8 games a session with some players doing
// multiple sessions a week, so 12 games this month is a realistic bar
// without being a stretch (2026-08-14).
const MIN_GAMES_FOR_CLUB_PLAYER = 12;

interface MonthlyLeader {
  playerId: string;
  value: number;
}

interface MonthlyHistoryRow {
  player_id: string;
  match_id: string;
  won: boolean;
  rating_delta: number;
  pre_rating: number;
  own_score: number;
  opponent_score: number;
  teammate_name: string;
  opponent_names: string;
}

interface ClubPlayerAward {
  playerId: string;
  games: number;
  winPct: number;
  ratingGain: number;
  composite: number;
}

interface SeasonStandingRow {
  playerId: string;
  rank: number;
  rating: number;
  games: number;
  wins: number;
  ratingGain: number;
}

// Past Club Player winners, one row per completed month — written by the
// same snapshot_month_end_leaderboard() call that powers the Top 10/Top 3
// badges. Forward-only: the first row will be whichever month is the
// first to complete after this shipped (2026-08-14), nothing backfilled.
interface PastClubPlayer {
  yearMonth: string;
  games: number;
  wins: number;
  winPct: number;
  ratingGain: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
}

function MonthlyStatCard({
  title,
  monthLabel,
  leaders,
  rowsById,
  formatValue,
  onSelectPlayer,
  emptyMessage,
}: {
  title: string;
  monthLabel: string;
  leaders: MonthlyLeader[];
  rowsById: Map<string, LeaderboardRow>;
  formatValue: (value: number) => string;
  onSelectPlayer: (id: string, name: string) => void;
  emptyMessage: string;
}) {
  const ranked = leaders
    .map((l) => ({ ...l, player: rowsById.get(l.playerId) }))
    .filter((l): l is MonthlyLeader & { player: LeaderboardRow } => !!l.player);

  return (
    <div className="card">
      <h2 style={{ marginBottom: 0 }}>{title}</h2>
      <p className="stat-meta" style={{ marginBottom: 12 }}>
        {monthLabel}
      </p>
      {ranked.length > 0 ? (
        ranked.map((entry, i) => (
          <div
            className="leaderboard-row"
            key={entry.playerId}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectPlayer(entry.player.id, entry.player.display_name)}
          >
            <span className="rank top3">{i + 1}</span>
            <Avatar name={entry.player.display_name} url={entry.player.avatar_url} size={28} />
            <span className="name">{entry.player.display_name}</span>
            <span className="rating">{formatValue(entry.value)}</span>
          </div>
        ))
      ) : (
        <p className="stat-meta">{emptyMessage}</p>
      )}
    </div>
  );
}

// Form guide strip (last 5 W/L dots per player) — removed 2026-09-03 at
// Ben's request: on narrower screens it crowded out the player name in the
// main leaderboard row. See get_recent_form() in the DB if this ever comes
// back — the RPC itself is untouched, just no longer called from here.

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
  onViewQuarterlyCup,
}: {
  onSelectPlayer: (id: string, name: string) => void;
  // Jumps to the Quarterly Cup tab for the full fixture list — only wired
  // up when that tab is actually visible to the signed-in viewer (see
  // App.tsx). Undefined just hides the "Manage" link below.
  onViewQuarterlyCup?: () => void;
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("rating");
  const [search, setSearch] = useState("");
  const [visibleEstablished, setVisibleEstablished] = useState(PAGE_SIZE);
  const [visibleProvisionalPlayed, setVisibleProvisionalPlayed] = useState(PROVISIONAL_PLAYED_INITIAL);
  const [visibleProvisionalUnplayed, setVisibleProvisionalUnplayed] = useState(PROVISIONAL_UNPLAYED_INITIAL);
  const [monthlyHistory, setMonthlyHistory] = useState<MonthlyHistoryRow[]>([]);
  const [pastClubPlayers, setPastClubPlayers] = useState<PastClubPlayer[]>([]);

  // Seasons — trackedSeasons is empty until 1 September 2026 (Autumn),
  // when Ben's chosen to start tracking. Standings are computed live via
  // get_season_standings rather than fetched from a table, since ratings
  // never reset between seasons so nothing needs to be pre-saved.
  const trackedSeasons = useMemo(() => getTrackedSeasons(), []);
  const currentSeason = useMemo(() => getCurrentSeason(), []);
  // "Ends [date] · N days left" shown when viewing the in-progress season
  // below (2026-09-02, Ben's request) — past seasons already have an end
  // date implicit in "Final standings", so this only applies to the
  // current one.
  const seasonEndInfo = useMemo(() => getSeasonEndInfo(currentSeason), [currentSeason]);
  const [viewedSeasonIndex, setViewedSeasonIndex] = useState(() => Math.max(0, trackedSeasons.length - 1));
  const [seasonStandings, setSeasonStandings] = useState<SeasonStandingRow[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(false);

  // The Quarterly Cup(s) (2026-09-02, extended to multiple cups
  // 2026-09-14) — every active or completed Cup, shown as public tables
  // here even though the fixture lists themselves live on their own tab.
  // Results are fully public (Ben confirmed this explicitly), so there's
  // no RLS restriction to work around here, unlike the Season standings
  // function above. Originally just the single most-recent cup; the club
  // now runs a Men's and a Women's cup concurrently, so this fetches all
  // of them — see quarterlyCupSortRank above for the Men's-before-Women's
  // ordering.
  const [quarterlyCups, setQuarterlyCups] = useState<QuarterlyCupWithData[]>([]);
  const [visibleSeasonRows, setVisibleSeasonRows] = useState(PAGE_SIZE);

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

    // Lazily records last month's Top 10 finishers (and Club Player — see
    // below) the first time anyone opens the leaderboard after the month
    // rolls over — no cron job in this project, so this is the trigger
    // instead. Cheap no-op almost every time (it self-guards against
    // re-running for a month that's already been recorded). Powers the
    // Top 10 / Top 3 badges.
    supabase.rpc("snapshot_month_end_leaderboard");

    supabase
      .from("monthly_club_player_awards")
      .select("year_month, player_id, games, wins, win_pct, rating_gain, players(display_name, avatar_url)")
      .order("year_month", { ascending: false })
      .limit(3)
      .then(({ data, error }) => {
        if (error || !data) return;
        setPastClubPlayers(
          data
            .filter((r) => !!r.players)
            .map((r) => {
              const player = r.players as unknown as { display_name: string; avatar_url: string | null };
              return {
                yearMonth: r.year_month as string,
                games: r.games as number,
                wins: r.wins as number,
                winPct: (r.win_pct as number) * 100,
                ratingGain: r.rating_gain as number,
                playerId: r.player_id as string,
                displayName: player.display_name,
                avatarUrl: player.avatar_url,
              };
            })
        );
      });
  }, []);

  useEffect(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    supabase
      .from("player_match_history")
      .select(
        "player_id, match_id, won, rating_delta, pre_rating, own_score, opponent_score, teammate_name, opponent_names"
      )
      .gte("played_at", monthStart)
      .then(({ data, error }) => {
        if (!error) setMonthlyHistory((data ?? []) as MonthlyHistoryRow[]);
      });

    // Every active/completed Quarterly Cup, not just the most recent one
    // (2026-09-14) — the club now runs a Men's and a Women's cup at the
    // same time. RLS on quarterly_cups etc. is "readable by any logged-in
    // member" (results are fully public), so this is a plain select, no
    // security-definer function needed like the Season standings above.
    supabase
      .from("quarterly_cups")
      .select("*")
      .in("status", ["active", "completed"])
      .order("created_at", { ascending: false })
      .then(async ({ data: cups }) => {
        const list = (cups ?? []) as QuarterlyCupRow[];
        if (list.length === 0) {
          setQuarterlyCups([]);
          return;
        }
        const withData = await Promise.all(
          list.map(async (cup) => {
            const [{ data: teams }, { data: matches }] = await Promise.all([
              supabase.from("quarterly_cup_teams").select("*").eq("cup_id", cup.id),
              supabase.from("quarterly_cup_matches").select("*, matches(team_a_score, team_b_score)").eq("cup_id", cup.id),
            ]);
            return {
              cup,
              teams: (teams ?? []) as QuarterlyCupTeamRow[],
              matches: (matches ?? []) as QuarterlyCupWithData["matches"],
            };
          })
        );
        withData.sort((a, b) => quarterlyCupSortRank(a.cup.name) - quarterlyCupSortRank(b.cup.name));
        setQuarterlyCups(withData);
      });
  }, []);

  useEffect(() => {
    if (trackedSeasons.length === 0) return;
    const season = trackedSeasons[viewedSeasonIndex];
    if (!season) return;
    setSeasonLoading(true);
    const isCurrent = season.key === currentSeason.key;
    const asOf = isCurrent ? new Date() : new Date(season.nextStart.getTime() - 1000);
    supabase
      .rpc("get_season_standings", { p_season_start: season.start.toISOString(), p_as_of: asOf.toISOString() })
      .then(({ data, error }) => {
        if (!error) {
          setSeasonStandings(
            (data ?? []).map(
              (r: { player_id: string; rank: number; rating: number; games: number; wins: number; rating_gain: number }) => ({
                playerId: r.player_id,
                rank: r.rank,
                rating: r.rating,
                games: r.games,
                wins: r.wins,
                ratingGain: r.rating_gain,
              })
            )
          );
        }
        setSeasonLoading(false);
        setVisibleSeasonRows(PAGE_SIZE);
      });
  }, [viewedSeasonIndex, trackedSeasons, currentSeason]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.display_name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  // Games played THIS calendar month, per player — reuses the same
  // monthlyHistory fetch the Club Player award already pulls (2026-09-21,
  // Ben's request). Powers the leaderboard-eligibility rule directly below:
  // separate from lifetime games_played/is_provisional, which never
  // decreases and is used elsewhere (badges, Dashboard, Club Stats) for "has
  // this player's rating ever settled" — a different question from "are
  // they active enough right now to be ranked."
  const monthGamesByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of monthlyHistory) {
      map.set(h.player_id, (map.get(h.player_id) ?? 0) + 1);
    }
    return map;
  }, [monthlyHistory]);

  // A player only counts as "established" on the club leaderboard if
  // they're both lifetime-established (12+ games ever, never resets) AND
  // have played 12+ games THIS calendar month (2026-09-21, Ben's request) —
  // otherwise someone could reach the top and then simply stop playing
  // while staying ranked there. Falls back to "Still establishing" exactly
  // like a genuinely new player, and comes back once they've logged 12
  // games again this month. Resets to zero on the 1st of every month, so
  // everyone temporarily drops out until they've played enough that month —
  // expected, not a bug.
  const established = useMemo(() => {
    const list = filteredRows.filter(
      (r) => !r.is_provisional && (monthGamesByPlayer.get(r.id) ?? 0) >= MIN_GAMES_FOR_CLUB_PLAYER
    );
    if (sort === "rating") {
      return [...list].sort((a, b) => b.rating - a.rating);
    }
    return [...list].sort((a, b) => (b.delta_30d ?? -Infinity) - (a.delta_30d ?? -Infinity));
  }, [filteredRows, sort, monthGamesByPlayer]);

  // Split into two (2026-09-01, Ben's request): someone who hasn't played
  // a single game yet is still sitting at the flat starting rating (1500),
  // which can look — and feel — like it's ranked above a player who HAS
  // played and dipped to, say, 1300-1400 in their first few games. Keeping
  // "haven't played at all" separate from "played at least one game, still
  // under 12" means a newer player who's had a rough start never has to
  // see someone who hasn't even played yet sitting "above" them.
  //
  // Also catches, since 2026-09-21, an otherwise-established player who
  // hasn't played 12 games this calendar month yet — they always have
  // games_played > 0 (that's what made them established in the first
  // place), so they land here rather than in "unplayed" below.
  const provisionalPlayed = useMemo(
    () =>
      [...filteredRows.filter((r) => r.games_played > 0 && (r.is_provisional || (monthGamesByPlayer.get(r.id) ?? 0) < MIN_GAMES_FOR_CLUB_PLAYER))].sort(
        (a, b) => b.rating - a.rating
      ),
    [filteredRows, monthGamesByPlayer]
  );
  // Everyone here is tied at exactly 1500 (nothing to rank by yet), so
  // alphabetical is the only ordering that actually means anything.
  const provisionalUnplayed = useMemo(
    () =>
      [...filteredRows.filter((r) => r.is_provisional && r.games_played === 0)].sort((a, b) =>
        a.display_name.localeCompare(b.display_name)
      ),
    [filteredRows]
  );

  useEffect(() => {
    setVisibleEstablished(PAGE_SIZE);
    setVisibleProvisionalPlayed(PROVISIONAL_PLAYED_INITIAL);
    setVisibleProvisionalUnplayed(PROVISIONAL_UNPLAYED_INITIAL);
  }, [search, sort]);

  const monthLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    []
  );

  // Only players who are active + profile-visible (i.e. already on the
  // leaderboard) are eligible to appear in these blocks.
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Top 5 for each stat (2026-09-01, raised from top 3 at Ben's request),
  // ties broken by whoever appears first in the query results — not worth
  // a fancier tiebreak for a monthly snapshot.
  const { mostGamesTop5, mostWinsTop5, highestWinPctTop5, biggestMoversTop5, clubPlayer } = useMemo(() => {
    const stats = new Map<string, { games: number; wins: number; ratingGain: number }>();
    for (const h of monthlyHistory) {
      if (!rowsById.has(h.player_id)) continue;
      const entry = stats.get(h.player_id) ?? { games: 0, wins: 0, ratingGain: 0 };
      entry.games += 1;
      if (h.won) entry.wins += 1;
      entry.ratingGain += h.rating_delta;
      stats.set(h.player_id, entry);
    }

    const entries = Array.from(stats.entries()).map(([playerId, { games, wins, ratingGain }]) => ({
      playerId,
      games,
      wins,
      ratingGain,
      winPct: games > 0 ? (wins / games) * 100 : 0,
    }));

    const mostGamesTop5: MonthlyLeader[] = [...entries]
      .sort((a, b) => b.games - a.games)
      .slice(0, 5)
      .map((e) => ({ playerId: e.playerId, value: e.games }));

    const mostWinsTop5: MonthlyLeader[] = [...entries]
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 5)
      .map((e) => ({ playerId: e.playerId, value: e.wins }));

    const highestWinPctTop5: MonthlyLeader[] = entries
      .filter((e) => e.games >= MIN_GAMES_FOR_WIN_PCT)
      .sort((a, b) => b.winPct - a.winPct)
      .slice(0, 5)
      .map((e) => ({ playerId: e.playerId, value: e.winPct }));

    // Only rewards genuine improvement — a player who lost rating this
    // month simply doesn't appear here, rather than showing up with a
    // negative value.
    const biggestMoversTop5: MonthlyLeader[] = entries
      .filter((e) => e.ratingGain > 0)
      .sort((a, b) => b.ratingGain - a.ratingGain)
      .slice(0, 5)
      .map((e) => ({ playerId: e.playerId, value: e.ratingGain }));

    // "Club Player" rewards well-rounded form rather than one big number:
    // an even blend of activity (games played), reliability (win %), and
    // improvement (rating gained), each scaled against the best in the
    // field this month so no single factor dominates just because of its
    // raw units. Needs a fuller month's picture than the win-% block
    // above, so it has its own (higher) minimum games threshold.
    const eligible = entries.filter((e) => e.games >= MIN_GAMES_FOR_CLUB_PLAYER);
    const maxGames = Math.max(0, ...eligible.map((e) => e.games));
    const maxRatingGain = Math.max(0, ...eligible.map((e) => e.ratingGain));
    const clubPlayerCandidates: ClubPlayerAward[] = eligible.map((e) => {
      const gamesNorm = maxGames > 0 ? e.games / maxGames : 0;
      const winPctNorm = e.winPct / 100;
      const ratingGainNorm = maxRatingGain > 0 ? Math.max(0, e.ratingGain) / maxRatingGain : 0;
      return {
        playerId: e.playerId,
        games: e.games,
        winPct: e.winPct,
        ratingGain: e.ratingGain,
        composite: (gamesNorm + winPctNorm + ratingGainNorm) / 3,
      };
    });
    const clubPlayer: ClubPlayerAward | null =
      clubPlayerCandidates.sort((a, b) => b.composite - a.composite)[0] ?? null;

    return { mostGamesTop5, mostWinsTop5, highestWinPctTop5, biggestMoversTop5, clubPlayer };
  }, [monthlyHistory, rowsById]);

  const clubPlayerRow = clubPlayer ? rowsById.get(clubPlayer.playerId) : undefined;

  if (loading) return <PageLoading label="Loading leaderboard…" />;
  if (error) return <p className="error">{error}</p>;

  const visibleEstablishedRows = established.slice(0, visibleEstablished);
  const visibleProvisionalPlayedRows = provisionalPlayed.slice(0, visibleProvisionalPlayed);
  const visibleProvisionalUnplayedRows = provisionalUnplayed.slice(0, visibleProvisionalUnplayed);

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
          {sort === "rating" ? "Ranked by current rating." : "Ranked by rating change over the last 30 days."}{" "}
          Requires 12+ games ever and 12+ games this calendar month — drops back to "Still establishing" without
          enough activity this month, then returns once you've played enough again.
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
            <span className="name" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.display_name}
              {/* Admin-created dummy account (2026-09-01) — see
                  types.ts's is_placeholder comment. */}
              {p.is_placeholder && (
                <span
                  title="Added by an admin — hasn't signed up themselves"
                  style={{
                    marginLeft: 6,
                    padding: "1px 6px",
                    borderRadius: 999,
                    background: "var(--border)",
                    color: "var(--text-muted)",
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    verticalAlign: "middle",
                  }}
                >
                  Guest
                </span>
              )}
            </span>
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
        <ShowMoreLess
          hasMore={established.length > visibleEstablished}
          expanded={visibleEstablished > PAGE_SIZE}
          moreCount={established.length - visibleEstablished}
          onShowMore={() => setVisibleEstablished((c) => c + PAGE_SIZE)}
          onShowLess={() => setVisibleEstablished(PAGE_SIZE)}
        />
        {clubPlayerRow && clubPlayer && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <p
              className="stat-meta"
              style={{
                color: "var(--orange-600)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 8,
              }}
            >
              🏓 Club Player — {monthLabel}
            </p>
            <div
              className="leaderboard-row"
              style={{ cursor: "pointer", borderBottom: "none", padding: "0 4px" }}
              onClick={() => onSelectPlayer(clubPlayerRow.id, clubPlayerRow.display_name)}
            >
              <Avatar name={clubPlayerRow.display_name} url={clubPlayerRow.avatar_url} size={28} />
              <span className="name">{clubPlayerRow.display_name}</span>
              <span className="stat-meta" style={{ margin: 0 }}>
                {clubPlayer.games} games · {Math.round(clubPlayer.winPct)}% wins ·{" "}
                {clubPlayer.ratingGain > 0 ? "+" : ""}
                {Math.round(clubPlayer.ratingGain)} rating
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Order (2026-09-15, Ben's request): Club leaderboard, then the
          current season leaderboard, then the Quarterly Cup(s), then
          everything else below. Was previously Club, Cups, Season
          (2026-09-14) — swapped so the season table sits right under Club
          leaderboard, with the Cup(s) below it. */}
      {trackedSeasons.length === 0 ? (
        <div className="card">
          <h2 style={{ marginBottom: 0 }}>Season leaderboard</h2>
          <p className="stat-meta" style={{ marginBottom: 0 }}>
            Seasons kick off with Autumn on 1 September — check back then to see standings.
          </p>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span
              className="link-action"
              role="button"
              tabIndex={0}
              aria-label="Previous season"
              onClick={() => viewedSeasonIndex > 0 && setViewedSeasonIndex((i) => i - 1)}
              style={{
                fontSize: "1.2rem",
                padding: "0 8px",
                opacity: viewedSeasonIndex === 0 ? 0.3 : 1,
                cursor: viewedSeasonIndex === 0 ? "default" : "pointer",
              }}
            >
              ‹
            </span>
            <h2 style={{ marginBottom: 0 }}>{trackedSeasons[viewedSeasonIndex].label}</h2>
            <span
              className="link-action"
              role="button"
              tabIndex={0}
              aria-label="Next season"
              onClick={() =>
                viewedSeasonIndex < trackedSeasons.length - 1 && setViewedSeasonIndex((i) => i + 1)
              }
              style={{
                fontSize: "1.2rem",
                padding: "0 8px",
                opacity: viewedSeasonIndex === trackedSeasons.length - 1 ? 0.3 : 1,
                cursor: viewedSeasonIndex === trackedSeasons.length - 1 ? "default" : "pointer",
              }}
            >
              ›
            </span>
          </div>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            {trackedSeasons[viewedSeasonIndex].key === currentSeason.key
              ? `In progress — ratings carry straight over, nothing resets. Ends ${seasonEndInfo.lastDay.toLocaleDateString(
                  undefined,
                  { weekday: "short", month: "short", day: "numeric" }
                )}${seasonEndInfo.daysLeft > 0 ? ` · ${seasonEndInfo.daysLeft} day${seasonEndInfo.daysLeft === 1 ? "" : "s"} left` : ""}.`
              : "Final standings for this season."}
          </p>
          {seasonLoading ? (
            <p className="stat-meta">Loading…</p>
          ) : seasonStandings.length === 0 ? (
            <p className="stat-meta">Nobody's established (12+ games) yet this season.</p>
          ) : (
            <>
              {seasonStandings.slice(0, visibleSeasonRows).map((row) => {
                const player = rowsById.get(row.playerId);
                if (!player) return null;
                return (
                  <div
                    className="leaderboard-row"
                    key={row.playerId}
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelectPlayer(player.id, player.display_name)}
                  >
                    <span className={`rank ${row.rank <= 3 ? "top3" : ""}`}>{row.rank}</span>
                    <Avatar name={player.display_name} url={player.avatar_url} size={28} />
                    <span className="name">{player.display_name}</span>
                    <span style={{ width: 56, textAlign: "right" }}>
                      <DeltaBadge value={row.ratingGain} />
                    </span>
                    <span className="rating">{Math.round(row.rating)}</span>
                  </div>
                );
              })}
              <ShowMoreLess
                hasMore={seasonStandings.length > visibleSeasonRows}
                expanded={visibleSeasonRows > PAGE_SIZE}
                moreCount={seasonStandings.length - visibleSeasonRows}
                onShowMore={() => setVisibleSeasonRows((c) => c + PAGE_SIZE)}
                onShowLess={() => setVisibleSeasonRows(PAGE_SIZE)}
              />
            </>
          )}
        </div>
      )}

      {quarterlyCups.map(({ cup, teams, matches }) => (
        <div className="card" key={cup.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h2 style={{ marginBottom: 0 }}>🏅 {cup.name}</h2>
            {onViewQuarterlyCup && (
              <span className="link-action" onClick={onViewQuarterlyCup}>
                Fixtures →
              </span>
            )}
          </div>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            {cup.status === "completed"
              ? "Final table."
              : (() => {
                  const info = cup.mirror_season_end
                    ? seasonEndInfo
                    : cup.end_date
                    ? (() => {
                        const lastDay = new Date(cup.end_date + "T00:00:00");
                        const daysLeft = Math.max(0, Math.ceil((lastDay.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
                        return { lastDay, daysLeft };
                      })()
                    : null;
                  if (!info) return "In progress.";
                  return `Completes ${info.lastDay.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}${info.daysLeft > 0 ? ` · ${info.daysLeft} day${info.daysLeft === 1 ? "" : "s"} left` : ""}.`;
                })()}
          </p>
          {cup.winner_team_id && (
            <p className="stat-meta" style={{ marginTop: 0, marginBottom: 12 }}>
              🏆 Champions:{" "}
              <strong style={{ color: "var(--heading)" }}>
                {(() => {
                  const t = teams.find((t) => t.id === cup.winner_team_id);
                  if (!t) return "?";
                  const nameById = new Map(rows.map((r) => [r.id, r.display_name]));
                  return t.team_name || `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`;
                })()}
              </strong>
            </p>
          )}
          {teams.length > 0 &&
            (() => {
              const nameById = new Map(rows.map((r) => [r.id, r.display_name]));
              const teamLabel = (teamId: string) => {
                const t = teams.find((t) => t.id === teamId);
                if (!t) return "?";
                return t.team_name || `${nameById.get(t.player1_id) ?? "?"} & ${nameById.get(t.player2_id) ?? "?"}`;
              };
              const standings = computeGroupStandings(
                teams.map((t) => t.id),
                matches
                  .filter((m) => m.matches)
                  .map((m) => ({
                    teamAId: m.team_a_id,
                    teamBId: m.team_b_id,
                    teamAScore: m.matches!.team_a_score,
                    teamBScore: m.matches!.team_b_score,
                  })),
                cup.scoring_system
              );
              return standings.map((row, i) => (
                <div className="leaderboard-row" key={row.teamId}>
                  <span className={`rank ${i < 3 ? "top3" : ""}`}>{i + 1}</span>
                  <span className="name">{teamLabel(row.teamId)}</span>
                  <span className="stat-meta" style={{ marginTop: 0, width: 48, textAlign: "right", fontSize: "0.78rem" }}>
                    {row.played}p {row.won}w
                  </span>
                  <span
                    className="stat-meta"
                    style={{ marginTop: 0, width: 76, textAlign: "right", whiteSpace: "nowrap", fontSize: "0.78rem" }}
                    title="Points for–against"
                  >
                    {row.pointsFor}–{row.pointsAgainst} ({row.diff >= 0 ? "+" : ""}
                    {row.diff})
                  </span>
                  <span className="rating">{row.pts}</span>
                </div>
              ));
            })()}
        </div>
      ))}

      <MonthlyStatCard
        title="Most games played"
        monthLabel={monthLabel}
        leaders={mostGamesTop5}
        rowsById={rowsById}
        formatValue={(v) => String(v)}
        onSelectPlayer={onSelectPlayer}
        emptyMessage="No games played yet this month."
      />

      <MonthlyStatCard
        title="Most wins"
        monthLabel={monthLabel}
        leaders={mostWinsTop5}
        rowsById={rowsById}
        formatValue={(v) => String(v)}
        onSelectPlayer={onSelectPlayer}
        emptyMessage="No games played yet this month."
      />

      <MonthlyStatCard
        title="Highest win %"
        monthLabel={monthLabel}
        leaders={highestWinPctTop5}
        rowsById={rowsById}
        formatValue={(v) => `${Math.round(v)}%`}
        onSelectPlayer={onSelectPlayer}
        emptyMessage={`Nobody's played ${MIN_GAMES_FOR_WIN_PCT}+ games yet this month.`}
      />

      <MonthlyStatCard
        title="Biggest movers"
        monthLabel={monthLabel}
        leaders={biggestMoversTop5}
        rowsById={rowsById}
        formatValue={(v) => `+${Math.round(v)}`}
        onSelectPlayer={onSelectPlayer}
        emptyMessage="Nobody's gained rating yet this month."
      />

      {pastClubPlayers.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 0 }}>Club Player — recent months</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Locked in once each month ends.
          </p>
          {pastClubPlayers.map((p) => (
            <div
              className="match-row"
              key={p.yearMonth}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectPlayer(p.playerId, p.displayName)}
            >
              <div>
                <div className="opponent">
                  {new Date(
                    Number(p.yearMonth.slice(0, 4)),
                    Number(p.yearMonth.slice(5, 7)) - 1,
                    1
                  ).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </div>
                <div className="meta">
                  {p.games} games · {Math.round(p.winPct)}% wins · {p.ratingGain > 0 ? "+" : ""}
                  {Math.round(p.ratingGain)} rating
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={p.displayName} url={p.avatarUrl} size={24} />
                <span style={{ fontWeight: 700, color: "var(--heading)" }}>{p.displayName}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Split into "played" and "not yet played" (2026-09-01, Ben's
          request) — see the provisionalPlayed/provisionalUnplayed memos
          above for why: someone sitting untouched at 1500 shouldn't visibly
          rank above someone who's actually played and dipped a bit, while
          both are still under 12 games. */}
      {provisionalPlayed.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 0 }}>Still establishing (played)</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Fewer than 12 games ever, or fewer than 12 games so far this month — either way, not currently ranked.
          </p>
          {visibleProvisionalPlayedRows.map((p) => {
            // Two different reasons land someone here (2026-09-21): a
            // genuinely new player under 12 games EVER, or an established
            // player who just hasn't played 12 games THIS calendar month —
            // showing lifetime games_played for the second case would read
            // as a nonsensical "35/12", so the badge switches to whichever
            // count is actually why they're in this list.
            const monthGames = monthGamesByPlayer.get(p.id) ?? 0;
            const isMonthlyOnly = !p.is_provisional;
            return (
              <div
                className="leaderboard-row"
                key={p.id}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectPlayer(p.id, p.display_name)}
              >
                <span className="badge badge-provisional" style={{ minWidth: 0 }}>
                  {isMonthlyOnly ? `${monthGames}/12 this month` : `${p.games_played}/12`}
                </span>
                <Avatar name={p.display_name} url={p.avatar_url} size={28} />
                <span className="name">{p.display_name}</span>
                <span className="rating">{Math.round(p.rating)}</span>
              </div>
            );
          })}
          {(provisionalPlayed.length > visibleProvisionalPlayed || visibleProvisionalPlayed > PROVISIONAL_PAGE_SIZE) && (
            <ShowMoreLess
              hasMore={provisionalPlayed.length > visibleProvisionalPlayed}
              expanded={visibleProvisionalPlayed > PROVISIONAL_PAGE_SIZE}
              moreCount={provisionalPlayed.length - visibleProvisionalPlayed}
              onShowMore={() => setVisibleProvisionalPlayed((c) => c + PROVISIONAL_PAGE_SIZE)}
              onShowLess={() => setVisibleProvisionalPlayed(PROVISIONAL_PAGE_SIZE)}
            />
          )}
        </div>
      )}

      {provisionalUnplayed.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 0 }}>Still establishing (unplayed)</h2>
          <p className="stat-meta" style={{ marginBottom: 12 }}>
            Joined but haven't logged a game yet — everyone starts at 1500.
          </p>
          {visibleProvisionalUnplayedRows.map((p) => (
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
          {(provisionalUnplayed.length > visibleProvisionalUnplayed || visibleProvisionalUnplayed > PROVISIONAL_PAGE_SIZE) && (
            <ShowMoreLess
              hasMore={provisionalUnplayed.length > visibleProvisionalUnplayed}
              expanded={visibleProvisionalUnplayed > PROVISIONAL_PAGE_SIZE}
              moreCount={provisionalUnplayed.length - visibleProvisionalUnplayed}
              onShowMore={() => setVisibleProvisionalUnplayed((c) => c + PROVISIONAL_PAGE_SIZE)}
              onShowLess={() => setVisibleProvisionalUnplayed(PROVISIONAL_PAGE_SIZE)}
            />
          )}
        </div>
      )}
    </div>
  );
}
