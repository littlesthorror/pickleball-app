// Player List (2026-09-24, Ben's request) — split out of AdminManagement,
// which had grown into "club settings + every member card" on one
// increasingly long page. Admins themselves stay on the Admins page (a
// short list); this page is the rest of the club, with the search bar,
// since looking someone up is the more frequent admin task day-to-day.
// Own top-level tab, admin-only (gated in App.tsx same as the other admin
// tabs) — fetches its own roster data independently from AdminManagement
// rather than sharing state across pages/tabs.
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { LegacyBadgeRow, PlayerPrivateInfo, PlayerStatus } from "../types";
import PageLoading from "../components/PageLoading";
import MemberList from "../components/MemberList";

export default function PlayerList({
  currentUserId,
  onSelectPlayer,
}: {
  currentUserId: string;
  onSelectPlayer?: (id: string, name: string) => void;
}) {
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [privateInfoByPlayer, setPrivateInfoByPlayer] = useState<Record<string, PlayerPrivateInfo>>({});
  const [legacyBadges, setLegacyBadges] = useState<LegacyBadgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from("player_status").select("*").order("display_name"),
      supabase.from("player_private_info").select("*"),
    ]).then(([{ data, error }, { data: privateRows }]) => {
      setPrivateInfoByPlayer(
        Object.fromEntries(((privateRows ?? []) as PlayerPrivateInfo[]).map((r) => [r.player_id, r]))
      );
      if (error) {
        setError(error.message);
      } else {
        setPlayers((data ?? []) as PlayerStatus[]);
      }
      setLoading(false);
    });
  }

  function loadLegacyBadges() {
    supabase
      .from("legacy_badges")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setLegacyBadges((data ?? []) as LegacyBadgeRow[]);
      });
  }

  useEffect(load, []);
  useEffect(loadLegacyBadges, []);

  if (loading) return <PageLoading label="Loading players…" />;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Player list</h1>
      <p className="stat-meta" style={{ marginBottom: 16 }}>
        Every member who isn't an admin. Search by name, or manage a specific player's roles, status and history.
        Admins themselves live on the Admins page instead.
      </p>

      <MemberList
        players={players}
        privateInfoByPlayer={privateInfoByPlayer}
        legacyBadges={legacyBadges}
        currentUserId={currentUserId}
        onSelectPlayer={onSelectPlayer}
        onReload={load}
        onReloadBadges={loadLegacyBadges}
        filter={(p) => !p.is_admin}
        showSearch
        searchPlaceholder="Search by name…"
        sortAdminsFirst={false}
        listLabel="member"
      />
    </div>
  );
}
