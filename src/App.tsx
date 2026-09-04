import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import MatchEntry from "./pages/MatchEntry";
import Matchmaking from "./pages/Matchmaking";
import Login from "./pages/Login";
import AdminManagement from "./pages/AdminManagement";
import GameHistory from "./pages/GameHistory";
import Dashboard from "./pages/Dashboard";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import PlayerDetail from "./pages/PlayerDetail";
import InviteGate from "./pages/InviteGate";
import Legal from "./pages/Legal";
import ClubStats from "./pages/ClubStats";
import Events from "./pages/Events";
import FAQ from "./pages/FAQ";
import Notices from "./pages/Notices";
import Competitions from "./pages/Competitions";
import QuarterlyCup from "./pages/QuarterlyCup";
import type { PlayerStatus } from "./types";
import { getCurrentSeason, isWithinNewSeasonWindow } from "./lib/seasons";
import { logError } from "./lib/errorLogging";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { ToastProvider } from "./components/Toast";
import PageLoading from "./components/PageLoading";

// One-line "new season" banner, shown for the first few days of each
// tracked season (see isWithinNewSeasonWindow) — purely time-window based,
// no per-player dismiss state to track. Ben specifically wanted this to
// reassure people nothing resets, not just announce the date.
const SEASON_EMOJI: Record<string, string> = { Spring: "🌱", Summer: "☀️", Autumn: "🍂", Winter: "❄️" };

// Kept as a runtime array (not just a type) so the "which tab was this
// hash?" check on refresh (below) can validate against it directly,
// rather than needing a second hand-maintained list in sync with the
// type. A tab a regular member isn't allowed to see (e.g. "manage-admins"
// surviving in the URL from when they were an admin, or a stale/shared
// link) is harmless to restore into state here — every tab's actual
// render site already gates on isAdmin/showCompetitionsTab, so an
// unauthorized tab value just renders nothing rather than the page.
const TABS = [
  "dashboard",
  "leaderboard",
  "club-stats",
  "events",
  "notices",
  "faq",
  "competitions",
  "quarterly-cup",
  "match-entry",
  "matchmaking",
  "manage-admins",
  "game-history",
  "profile",
] as const;
type Tab = (typeof TABS)[number];

// Smart matchmaking (2026-09-04) — switched off 2026-09-05 at Ben's request
// while it's parked for now. Nothing's been removed, just gated behind this
// one flag: flip it back to true to bring the nav button and tab back.
const MATCHMAKING_ENABLED = false;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [player, setPlayer] = useState<PlayerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // Defaults to "dashboard" as before, but a push notification tap (see
  // src/sw.ts's notificationclick handler) opens the app at "/#notices" or
  // "/#events" — there's no real client-side router here, so a URL hash is
  // the lightest way to land directly on the right tab instead of always
  // landing on the dashboard. Added 2026-08-25 alongside push notifications.
  //
  // Extended 2026-08-31 to cover every tab, not just notices/events — Ben
  // asked for hitting the browser's refresh button to keep you on whatever
  // tab you were viewing instead of always bouncing back to the dashboard.
  // The matching write side is the effect below, which keeps the hash in
  // sync with `tab` via history.replaceState (not pushState — this is
  // deliberately NOT the same thing as wiring up the back button, which
  // was explicitly left for later; replaceState never adds a history
  // entry, so it only survives a refresh and doesn't change what the
  // browser's own Back button does).
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "matchmaking" && !MATCHMAKING_ENABLED) return "dashboard";
    return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : "dashboard";
  });

  useEffect(() => {
    window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  // backLabel (2026-08-28) — PlayerDetail's back button now reads "Back to
  // leaderboard" or "Back to Manage admins" depending on where the click
  // actually came from, rather than always saying leaderboard even when an
  // admin got here from Manage Admins.
  const [viewingPlayer, setViewingPlayer] = useState<{ id: string; name: string; backLabel: string } | null>(null);
  // Lets an admin see exactly what a regular player sees — hides admin
  // tabs/controls in the UI only. Doesn't touch the real is_admin flag, so
  // permissions (RLS, edge functions) are completely unaffected; this is a
  // look-but-don't-touch preview, not an actual demotion.
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false);
  // Global on/off switch for the Competitions tab (2026-08-26) — regular
  // members only see it while a competition is actually being run; admins
  // always see it so they can set the next one up ahead of time without
  // needing to flip the switch on first. See AdminManagement.tsx for the
  // toggle itself.
  const [showCompetitionsTab, setShowCompetitionsTab] = useState(false);
  // Same pattern for The Quarterly Cup's tab (2026-09-02) — its own
  // standalone mini-league, separate from both Competitions and the main
  // Season leaderboard. See AdminManagement.tsx for the toggle itself.
  const [showQuarterlyCupTab, setShowQuarterlyCupTab] = useState(false);
  // Entered players see the Cup tab even while the club-wide toggle above
  // is off — they need to reach their own fixtures before the admin is
  // ready to publish it to everyone (2026-09-02, Ben's request). Unlike
  // club_settings, quarterly_cup_teams is readable by any logged-in member
  // (see 0062 migration), so this is a plain select, no RPC needed.
  const [isQuarterlyCupParticipant, setIsQuarterlyCupParticipant] = useState(false);

  useEffect(() => {
    // Reads via an RPC rather than selecting the table directly (2026-08-28
    // bugfix) — club_settings' only SELECT policy is admin-only (it also
    // holds the invite code, which must stay that way), so a direct select
    // silently returned nothing for regular members and the tab never
    // appeared for them even once an admin switched it on. See
    // 0053_add_get_show_competitions_tab_rpc.sql.
    supabase.rpc("get_show_competitions_tab").then(({ data }) => setShowCompetitionsTab(!!data));
    supabase.rpc("get_show_quarterly_cup_tab").then(({ data }) => setShowQuarterlyCupTab(!!data));
  }, []);

  useEffect(() => {
    if (!player?.id) {
      setIsQuarterlyCupParticipant(false);
      return;
    }
    supabase
      .from("quarterly_cup_teams")
      .select("id")
      .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
      .limit(1)
      .then(({ data }) => setIsQuarterlyCupParticipant((data?.length ?? 0) > 0));
  }, [player?.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // True once the initial "does this account have a player row yet?" check
  // has actually resolved — needed to tell "still loading" apart from
  // "checked, and no — this is a new sign-in that needs an invite code".
  const [playerChecked, setPlayerChecked] = useState(false);
  const [showLegal, setShowLegal] = useState(false);

  function loadPlayer() {
    if (!session) {
      setPlayer(null);
      setPlayerChecked(true);
      return;
    }
    // A player row only exists once someone has redeemed an invite code
    // (see InviteGate.tsx / redeem_invite_code()) — a brand-new sign-in
    // legitimately has none yet, so maybeSingle() rather than single().
    supabase
      .from("player_status")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPlayer((data as PlayerStatus) ?? null);
        setPlayerChecked(true);
      });
  }

  useEffect(() => {
    setPlayerChecked(false);
    loadPlayer();
  }, [session]);

  // Dark mode (2026-08-28) — a data-theme attribute on <html>, driven by
  // the signed-in player's own saved preference (see Profile.tsx), so it
  // follows the account across devices rather than being tied to one
  // browser's storage. index.css has the actual dark palette overrides
  // scoped to [data-theme="dark"].
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", player?.dark_mode ? "dark" : "light");
  }, [player?.dark_mode]);

  // "New since you last looked" tracking for the Notices/Events nav
  // buttons — last_seen_*_at lives on the players row itself (not the
  // player_status view, which doesn't expose it) so it's fetched
  // separately here. Re-fetched whenever the signed-in player changes.
  const [lastSeenNotices, setLastSeenNotices] = useState<string | null>(null);
  const [lastSeenEvents, setLastSeenEvents] = useState<string | null>(null);
  const [latestNoticeAt, setLatestNoticeAt] = useState<string | null>(null);
  const [latestEventAt, setLatestEventAt] = useState<string | null>(null);

  useEffect(() => {
    if (!player) return;
    supabase
      .from("players")
      .select("last_seen_notices_at, last_seen_events_at")
      .eq("id", player.id)
      .single()
      .then(({ data }) => {
        setLastSeenNotices(data?.last_seen_notices_at ?? null);
        setLastSeenEvents(data?.last_seen_events_at ?? null);
      });
    supabase
      .from("notices")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => setLatestNoticeAt(data?.[0]?.created_at ?? null));
    supabase
      .from("events")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => setLatestEventAt(data?.[0]?.created_at ?? null));
  }, [player?.id]);

  const showSeasonBanner = isWithinNewSeasonWindow();
  const currentSeason = getCurrentSeason();

  const hasNewNotice =
    !!latestNoticeAt && (!lastSeenNotices || new Date(latestNoticeAt) > new Date(lastSeenNotices));
  const hasNewEvent =
    !!latestEventAt && (!lastSeenEvents || new Date(latestEventAt) > new Date(lastSeenEvents));

  function markNoticesSeen() {
    if (!player || !hasNewNotice) return;
    const now = new Date().toISOString();
    setLastSeenNotices(now);
    // Note: supabase-js resolves this with { error } on an API-level failure
    // (RLS denial, bad request, etc.) rather than rejecting the promise — a
    // bare fire-and-forget call here would silently swallow that forever,
    // which is exactly what let the "always has a red dot" bug go
    // undetected. Logging the error explicitly (2026-08-26) makes any real
    // failure show up in the admin error log instead of vanishing.
    supabase
      .from("players")
      .update({ last_seen_notices_at: now })
      .eq("id", player.id)
      .then(({ error }) => {
        if (error) logError(`markNoticesSeen: ${error.message}`, undefined, "markNoticesSeen");
      });
  }

  function markEventsSeen() {
    if (!player || !hasNewEvent) return;
    const now = new Date().toISOString();
    setLastSeenEvents(now);
    supabase
      .from("players")
      .update({ last_seen_events_at: now })
      .eq("id", player.id)
      .then(({ error }) => {
        if (error) logError(`markEventsSeen: ${error.message}`, undefined, "markEventsSeen");
      });
  }

  // Marks Notices/Events "seen" whenever they're the active tab and there's
  // something new — covers a normal nav-bar click, but also two gaps a plain
  // changeTab()-only call missed: (1) landing directly on "notices"/"events"
  // via a push-notification deep link, which sets `tab` straight from the
  // URL hash and never goes through changeTab at all, and (2) the
  // hasNewNotice/hasNewEvent fetch resolving *after* the user has already
  // switched tabs, which used to leave the dot permanently stuck on with no
  // way to re-trigger it (the nav button disables itself once its tab is
  // active).
  useEffect(() => {
    if (tab === "notices") markNoticesSeen();
    if (tab === "events") markEventsSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hasNewNotice, hasNewEvent, player?.id]);

  function changeTab(next: Tab) {
    setViewingPlayer(null);
    setTab(next);
  }

  function togglePreview() {
    const next = !previewAsPlayer;
    setPreviewAsPlayer(next);
    // Bounce back to the dashboard if entering preview mode from a tab a
    // regular player wouldn't have access to.
    if (next && (tab === "match-entry" || tab === "matchmaking" || tab === "manage-admins")) {
      setTab("dashboard");
    }
  }

  if (loading) return null;

  const effectiveIsAdmin = !!player?.is_admin && !previewAsPlayer;

  return (
    <ConfirmProvider>
      <ToastProvider>
        <div className="page">
      {session ? (
        <>
          <div className="app-header">
            <div
              className="brand"
              role="button"
              tabIndex={0}
              aria-label="Go to Dashboard"
              onClick={() => changeTab("dashboard")}
              onKeyDown={(e) => e.key === "Enter" && changeTab("dashboard")}
              style={{ cursor: "pointer" }}
            >
              {/* Drop your club logo file at public/logo.png and it'll show
                  up here automatically — see README for where to add it. */}
              <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
              <span className="brand-name">Sideline</span>
            </div>
            {player && (
              <div className="account">
                <span
                  className="link-action"
                  role="button"
                  tabIndex={0}
                  onClick={() => changeTab("profile")}
                >
                  My account
                </span>
              </div>
            )}
          </div>

          {previewAsPlayer && (
            <div className="preview-banner">
              Viewing as a regular player —{" "}
              <span className="link-action" role="button" tabIndex={0} onClick={togglePreview}>
                exit preview
              </span>
            </div>
          )}

          {showSeasonBanner && (
            <div className="preview-banner">
              {SEASON_EMOJI[currentSeason.name]} A new season has begun — {currentSeason.label} is under way.
              Ratings carry straight over, nothing resets.
            </div>
          )}

          {!playerChecked ? (
            <PageLoading label="Loading your profile…" />
          ) : !player ? (
            <InviteGate onJoined={loadPlayer} />
          ) : !player.profile_completed ? (
            <Profile player={player} isFirstTime onSaved={setPlayer} />
          ) : (
            <>
              {/* Nav stays visible at all times once signed in — previously
                  it disappeared entirely while viewing a clubmate's profile
                  (via the leaderboard click-through), leaving only a small
                  "back" link as the way out. Fixed 2026-08-05. */}
              <div className="nav-wrap">
                <div className="nav">
                  <button disabled={tab === "dashboard"} onClick={() => changeTab("dashboard")}>
                    Dashboard
                  </button>
                  <button disabled={tab === "leaderboard"} onClick={() => changeTab("leaderboard")}>
                    Leaderboard
                  </button>
                  <button disabled={tab === "club-stats"} onClick={() => changeTab("club-stats")}>
                    Club stats
                  </button>
                  <button
                    disabled={tab === "events"}
                    onClick={() => changeTab("events")}
                    style={{ position: "relative" }}
                  >
                    Events
                    {hasNewEvent && (
                      <span
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--orange-600)",
                        }}
                      />
                    )}
                  </button>
                  <button
                    disabled={tab === "notices"}
                    onClick={() => changeTab("notices")}
                    style={{ position: "relative" }}
                  >
                    News
                    {hasNewNotice && (
                      <span
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--orange-600)",
                        }}
                      />
                    )}
                  </button>
                  {/* Comps/Cup share the main tab row rather than getting
                      their own — a separate row for just two buttons read as
                      three stacked, disconnected bars, which looked worse
                      than the occasional wrap. They keep a colored outline
                      (.nav-btn-special) so they still stand out, and the
                      row's own flex-wrap/scroll handles overflow the same
                      way it always has. Reverted 2026-09-02 per Ben's
                      feedback. Placed before FAQ (also 2026-09-02, Ben's
                      request) so FAQ always anchors the end of the row
                      regardless of which special tabs are currently live. */}
                  {(showCompetitionsTab || effectiveIsAdmin) && (
                    <button
                      className="nav-btn-special"
                      disabled={tab === "competitions"}
                      onClick={() => changeTab("competitions")}
                    >
                      🏆 Comps
                    </button>
                  )}
                  {(showQuarterlyCupTab || isQuarterlyCupParticipant || effectiveIsAdmin) && (
                    <button
                      className="nav-btn-special nav-btn-cup"
                      disabled={tab === "quarterly-cup"}
                      onClick={() => changeTab("quarterly-cup")}
                    >
                      🏅 Cup
                    </button>
                  )}
                  <button disabled={tab === "faq"} onClick={() => changeTab("faq")}>
                    FAQ
                  </button>
                </div>
              </div>

              {effectiveIsAdmin && (
                <div className="nav">
                  <button disabled={tab === "match-entry"} onClick={() => changeTab("match-entry")}>
                    Enter match
                  </button>
                  {MATCHMAKING_ENABLED && (
                    <button disabled={tab === "matchmaking"} onClick={() => changeTab("matchmaking")}>
                      Matchmaking
                    </button>
                  )}
                  <button disabled={tab === "manage-admins"} onClick={() => changeTab("manage-admins")}>
                    Admins
                  </button>
                  <button disabled={tab === "game-history"} onClick={() => changeTab("game-history")}>
                    Game history
                  </button>
                </div>
              )}

              {viewingPlayer ? (
                <PlayerDetail
                  playerId={viewingPlayer.id}
                  playerName={viewingPlayer.name}
                  viewerId={player.id}
                  backLabel={viewingPlayer.backLabel}
                  onBack={() => setViewingPlayer(null)}
                />
              ) : (
                <>
                  {tab === "dashboard" && (
                    <Dashboard playerId={player.id} isOwnProfile onViewEvents={() => changeTab("events")} />
                  )}
                  {tab === "leaderboard" && (
                    <Leaderboard
                      onSelectPlayer={(id, name) => setViewingPlayer({ id, name, backLabel: "Back to leaderboard" })}
                      onViewQuarterlyCup={
                        showQuarterlyCupTab || isQuarterlyCupParticipant || effectiveIsAdmin
                          ? () => changeTab("quarterly-cup")
                          : undefined
                      }
                    />
                  )}
                  {tab === "club-stats" && <ClubStats />}
                  {tab === "events" && <Events isAdmin={effectiveIsAdmin} playerId={player.id} />}
                  {tab === "notices" && <Notices isAdmin={effectiveIsAdmin} playerId={player.id} />}
                  {tab === "faq" && <FAQ isAdmin={effectiveIsAdmin} />}
                  {tab === "competitions" && (showCompetitionsTab || effectiveIsAdmin) && (
                    <Competitions isAdmin={effectiveIsAdmin} currentUserId={player.id} />
                  )}
                  {tab === "quarterly-cup" && (showQuarterlyCupTab || isQuarterlyCupParticipant || effectiveIsAdmin) && (
                    <QuarterlyCup isAdmin={effectiveIsAdmin} currentUserId={player.id} />
                  )}
                  {tab === "match-entry" && effectiveIsAdmin && <MatchEntry />}
                  {tab === "matchmaking" && MATCHMAKING_ENABLED && effectiveIsAdmin && <Matchmaking />}
                  {tab === "manage-admins" && effectiveIsAdmin && (
                    <AdminManagement
                      currentUserId={session.user.id}
                      onSelectPlayer={(id, name) => setViewingPlayer({ id, name, backLabel: "Back to Manage admins" })}
                    />
                  )}
                  {tab === "game-history" && effectiveIsAdmin && <GameHistory />}
                  {tab === "profile" && (
                    <Profile
                      player={player}
                      isFirstTime={false}
                      onSaved={setPlayer}
                      isAdmin={!!player.is_admin}
                      previewAsPlayer={previewAsPlayer}
                      onTogglePreview={togglePreview}
                    />
                  )}
                </>
              )}
            </>
          )}

          <div className="app-footer">
            Huntingdon Pickleball
            <br />
            <span
              className="link-action legal-link"
              role="button"
              tabIndex={0}
              onClick={() => setShowLegal(true)}
            >
              Terms &amp; ownership
            </span>
          </div>

          {showLegal && <Legal onClose={() => setShowLegal(false)} />}
        </>
      ) : (
        <Login />
      )}
        </div>
      </ToastProvider>
    </ConfirmProvider>
  );
}
