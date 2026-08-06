import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import MatchEntry from "./pages/MatchEntry";
import Login from "./pages/Login";
import AdminManagement from "./pages/AdminManagement";
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
import type { PlayerStatus } from "./types";

type Tab =
  | "dashboard"
  | "leaderboard"
  | "club-stats"
  | "events"
  | "notices"
  | "faq"
  | "match-entry"
  | "manage-admins"
  | "profile";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [player, setPlayer] = useState<PlayerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [viewingPlayer, setViewingPlayer] = useState<{ id: string; name: string } | null>(null);
  // Lets an admin see exactly what a regular player sees — hides admin
  // tabs/controls in the UI only. Doesn't touch the real is_admin flag, so
  // permissions (RLS, edge functions) are completely unaffected; this is a
  // look-but-don't-touch preview, not an actual demotion.
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false);

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

  function changeTab(next: Tab) {
    setViewingPlayer(null);
    setTab(next);
  }

  function togglePreview() {
    const next = !previewAsPlayer;
    setPreviewAsPlayer(next);
    // Bounce back to the dashboard if entering preview mode from a tab a
    // regular player wouldn't have access to.
    if (next && (tab === "match-entry" || tab === "manage-admins")) {
      setTab("dashboard");
    }
  }

  if (loading) return null;

  const effectiveIsAdmin = !!player?.is_admin && !previewAsPlayer;

  return (
    <div className="page">
      {session ? (
        <>
          <div className="app-header">
            <div className="brand">
              {/* Drop your club logo file at public/logo.png and it'll show
                  up here automatically — see README for where to add it. */}
              <img src="/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
              <span className="brand-name">GhostShot</span>
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

          {!playerChecked ? (
            <p>Loading your profile…</p>
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
                <button disabled={tab === "events"} onClick={() => changeTab("events")}>
                  Events
                </button>
                <button disabled={tab === "notices"} onClick={() => changeTab("notices")}>
                  Notices
                </button>
                <button disabled={tab === "faq"} onClick={() => changeTab("faq")}>
                  FAQ
                </button>
              </div>

              {effectiveIsAdmin && (
                <div className="nav">
                  <button disabled={tab === "match-entry"} onClick={() => changeTab("match-entry")}>
                    Enter match
                  </button>
                  <button disabled={tab === "manage-admins"} onClick={() => changeTab("manage-admins")}>
                    Admins
                  </button>
                </div>
              )}

              {viewingPlayer ? (
                <PlayerDetail
                  playerId={viewingPlayer.id}
                  playerName={viewingPlayer.name}
                  onBack={() => setViewingPlayer(null)}
                />
              ) : (
                <>
                  {tab === "dashboard" && (
                    <Dashboard playerId={player.id} isOwnProfile onViewEvents={() => changeTab("events")} />
                  )}
                  {tab === "leaderboard" && (
                    <Leaderboard onSelectPlayer={(id, name) => setViewingPlayer({ id, name })} />
                  )}
                  {tab === "club-stats" && <ClubStats />}
                  {tab === "events" && <Events isAdmin={effectiveIsAdmin} />}
                  {tab === "notices" && <Notices isAdmin={effectiveIsAdmin} />}
                  {tab === "faq" && <FAQ isAdmin={effectiveIsAdmin} />}
                  {tab === "match-entry" && effectiveIsAdmin && <MatchEntry />}
                  {tab === "manage-admins" && effectiveIsAdmin && (
                    <AdminManagement currentUserId={session.user.id} />
                  )}
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
  );
}
