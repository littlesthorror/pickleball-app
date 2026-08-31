import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import { getExistingSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from "../lib/push";
import { downloadCsv } from "../lib/csvExport";
import { compressImageFile } from "../lib/imageCompress";
import type { PlayerStatus, PlayerMatchHistoryRow, PlayerPrivateInfo } from "../types";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

// Used two ways: as a one-time "complete your profile" step right after
// first Google sign-in (isFirstTime=true, no way to skip past it except
// saving), and later as a normal editable Profile tab. Full name, DOB, and
// photo are all optional to *change* from their Google-provided defaults —
// nothing here is required except clicking Save once, per the brief's
// intent of keeping friction low.
export default function Profile({
  player,
  isFirstTime,
  onSaved,
  isAdmin = false,
  previewAsPlayer = false,
  onTogglePreview,
}: {
  player: PlayerStatus;
  isFirstTime: boolean;
  onSaved: (updated: PlayerStatus) => void;
  // Sign out and (for admins) the preview-as-player toggle used to live in
  // the app header — moved here now that the header's been simplified down
  // to just the logo and a "My account" link. Only relevant once the
  // account already exists, so unused during first-time setup.
  isAdmin?: boolean;
  previewAsPlayer?: boolean;
  onTogglePreview?: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(player.display_name);
  const [dob, setDob] = useState(player.date_of_birth ?? "");
  const [dobVisible, setDobVisible] = useState(player.date_of_birth_visible);
  const [profileVisible, setProfileVisible] = useState(player.profile_visible);
  const [avatarUrl, setAvatarUrl] = useState(player.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Emergency contact (2026-08-28) — name + phone, editable here, but only
  // ever shown to admins elsewhere (AdminManagement) — never to other
  // regular members. Saved as part of the normal Save button below, same
  // as name/DOB.
  //
  // Moved 2026-08-31 into their own `player_private_info` table, locked
  // down by RLS to "the player themselves, or an admin" — these no longer
  // come from the `player` prop (PlayerStatus/player_status no longer
  // carries them at all), so they're fetched separately below.
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  // Essential Medical Information (2026-08-28) — conditions, allergies,
  // current medications. Same admin-only visibility as the emergency
  // contact fields above, same save path.
  const [medicalInfo, setMedicalInfo] = useState("");

  useEffect(() => {
    if (isFirstTime) return; // nothing to fetch yet during first-time setup
    supabase
      .from("player_private_info")
      .select("*")
      .eq("player_id", player.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as PlayerPrivateInfo | null;
        if (row) {
          setEmergencyName(row.emergency_contact_name ?? "");
          setEmergencyPhone(row.emergency_contact_phone ?? "");
          setMedicalInfo(row.medical_info ?? "");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.id, isFirstTime]);

  // Linked Google account email (2026-08-28) — read-only, purely so
  // someone on a shared/family device can confirm which account they're
  // signed in as without needing to ask an admin. Fetched once from the
  // auth session rather than the players table (email lives on
  // auth.users, not public.players).
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setGoogleEmail(data.user?.email ?? null));
  }, []);

  // Dark mode (2026-08-28) — saved to the account (not localStorage) so it
  // follows you across devices. Applied instantly on toggle via onSaved,
  // which App.tsx watches to flip a data-theme attribute — see App.tsx.
  const [darkMode, setDarkMode] = useState(player.dark_mode);
  const [darkModeSaving, setDarkModeSaving] = useState(false);
  async function handleToggleDarkMode() {
    const next = !darkMode;
    setDarkMode(next);
    setDarkModeSaving(true);
    const { error: darkModeError } = await supabase.from("players").update({ dark_mode: next }).eq("id", player.id);
    setDarkModeSaving(false);
    if (darkModeError) {
      setDarkMode(!next);
      toast.error(`Couldn't update: ${darkModeError.message}`);
      return;
    }
    onSaved({ ...player, dark_mode: next });
  }

  // Granular push categories (2026-08-28) — replaces the old single
  // on/off switch. Each toggle writes straight to the players row (not
  // gated behind the main Save button) since these feel like instant
  // settings, same UX as the dark mode toggle above. Only meaningful once
  // actually subscribed (see pushSubscribed below), so disabled until then.
  const [notifyNewEvents, setNotifyNewEvents] = useState(player.notify_new_events);
  const [notifyNewNotices, setNotifyNewNotices] = useState(player.notify_new_notices);
  const [notifyBadgeEarned, setNotifyBadgeEarned] = useState(player.notify_badge_earned);
  const [notifyRankChange, setNotifyRankChange] = useState(player.notify_rank_change);
  const [categorySaving, setCategorySaving] = useState<string | null>(null);

  async function handleToggleCategory(
    key: "notify_new_events" | "notify_new_notices" | "notify_badge_earned" | "notify_rank_change",
    current: boolean,
    setter: (v: boolean) => void
  ) {
    const next = !current;
    setter(next);
    setCategorySaving(key);
    const { error: catError } = await supabase.from("players").update({ [key]: next }).eq("id", player.id);
    setCategorySaving(null);
    if (catError) {
      setter(current);
      toast.error(`Couldn't update: ${catError.message}`);
    }
  }

  // Download my data / delete my account (2026-08-28) — self-service GDPR
  // requests. Download compiles everything readable under this account's
  // own RLS access into one JSON file, client-side, no edge function
  // needed. Delete calls a dedicated edge function (see
  // supabase/functions/delete-account) since it needs the service role to
  // ban the auth user — see that function's own comment for why this
  // anonymizes + bans rather than actually deleting anything.
  const [exportingData, setExportingData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDownloadMyData() {
    setExportingData(true);
    const [{ data: matches }, { data: rsvps }, { data: pollVotes }] = await Promise.all([
      supabase.from("player_match_history").select("*").eq("player_id", player.id).order("game_number", { ascending: true }),
      supabase.from("event_rsvps").select("event_id, status, created_at").eq("player_id", player.id),
      supabase.from("notice_poll_votes").select("notice_id, option_index, created_at").eq("player_id", player.id),
    ]);
    setExportingData(false);

    const exportData = {
      exported_at: new Date().toISOString(),
      profile: {
        display_name: player.display_name,
        date_joined: player.date_joined,
        date_of_birth: player.date_of_birth,
        role_title: player.role_title,
        rating: player.rating,
        games_played: player.games_played,
        // Read from state (fetched from player_private_info on mount)
        // rather than the `player` prop — these fields moved out of
        // PlayerStatus 2026-08-31, see types.ts's PlayerPrivateInfo comment.
        emergency_contact_name: emergencyName || null,
        emergency_contact_phone: emergencyPhone || null,
        medical_info: medicalInfo || null,
        google_email: googleEmail,
      },
      match_history: matches ?? [],
      event_rsvps: rsvps ?? [],
      notice_poll_votes: pollVotes ?? [],
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sideline-my-data-${player.display_name.replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteAccount() {
    if (
      !(await confirm(
        "Delete your Sideline account? Your name, photo, date of birth, and contact info will be permanently cleared, and you won't be able to sign back in. Your past match results stay on record (as anonymous history) since other members' stats depend on them. This can't be undone — continue?",
        { danger: true }
      ))
    ) {
      return;
    }
    setDeletingAccount(true);
    setDeleteError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("delete-account", { body: {} });
    setDeletingAccount(false);
    if (invokeError || (data as { error?: string })?.error) {
      setDeleteError(invokeError?.message ?? (data as { error?: string })?.error ?? "Something went wrong.");
      return;
    }
    await supabase.auth.signOut();
  }

  // Export my match history (2026-08-28) — a plain CSV of every confirmed
  // match this player's been part of, for people who'd rather keep their
  // own record outside the app.
  const [exportingCsv, setExportingCsv] = useState(false);
  async function handleExportMatchHistory() {
    setExportingCsv(true);
    const { data, error: exportError } = await supabase
      .from("player_match_history")
      .select("*")
      .eq("player_id", player.id)
      .order("game_number", { ascending: true });
    setExportingCsv(false);
    if (exportError || !data) {
      toast.error(`Couldn't export: ${exportError?.message ?? "no data returned"}`);
      return;
    }
    const rows = data as PlayerMatchHistoryRow[];
    downloadCsv(
      `sideline-match-history-${player.display_name.replace(/\s+/g, "-")}.csv`,
      ["Date", "Teammate", "Opponents", "Your score", "Opponent score", "Result", "Rating before", "Rating after", "Rating change"],
      rows.map((h) => [
        new Date(h.played_at).toLocaleDateString("en-GB"),
        h.teammate_name,
        h.opponent_names,
        h.own_score,
        h.opponent_score,
        h.won ? "Win" : "Loss",
        Math.round(h.pre_rating),
        Math.round(h.post_rating),
        Math.round(h.rating_delta),
      ])
    );
  }

  // Push notifications (2026-08-25) — see src/lib/push.ts. Only relevant
  // once the account exists (not during first-time setup), and only in
  // browsers that support the Push API at all (notably not iOS Safari
  // unless the app's been added to the home screen).
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (isFirstTime || !isPushSupported()) return;
    getExistingSubscription().then((sub) => setPushSubscribed(!!sub));
  }, [isFirstTime]);

  async function handleTogglePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushSubscribed) {
        await unsubscribeFromPush();
        setPushSubscribed(false);
      } else {
        await subscribeToPush(player.id);
        setPushSubscribed(true);
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Couldn't update notification settings.");
    }
    setPushBusy(false);
  }

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    // Downscaled before upload (2026-08-29 bugfix) — avatars were
    // previously uploaded at full original resolution (a phone photo can
    // easily be several MB), and this photo never renders larger than a
    // couple hundred px anywhere in the app. With ~30 members' avatars
    // re-fetched by everyone on every leaderboard/dashboard visit, that was
    // the single biggest driver behind Supabase's Fair Use Policy email —
    // see imageCompress.ts. 500px is generous headroom over the largest
    // on-screen size while still cutting a multi-MB photo down to well
    // under 100KB.
    let compressedFile: File;
    try {
      compressedFile = await compressImageFile(file, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that photo.");
      setUploading(false);
      return;
    }
    const ext = compressedFile.name.split(".").pop() || "jpg";
    const path = `${player.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, compressedFile, { upsert: true, cacheControl: "31536000" });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    // Cache-bust so the new photo shows immediately instead of a stale
    // browser-cached version at the same URL.
    setAvatarUrl(`${data.publicUrl}?t=${Date.now()}`);
    setUploading(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("players")
      .update({
        display_name: displayName.trim() || player.display_name,
        date_of_birth: dob || null,
        date_of_birth_visible: dobVisible,
        avatar_url: avatarUrl,
        profile_visible: profileVisible,
        profile_completed: true,
      })
      .eq("id", player.id);

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    // Separate table since 2026-08-31 (see types.ts's PlayerPrivateInfo
    // comment) — upsert rather than update, since a player who's never
    // filled these in yet has no row here at all.
    const { error: privateInfoError } = await supabase.from("player_private_info").upsert({
      player_id: player.id,
      emergency_contact_name: emergencyName.trim() || null,
      emergency_contact_phone: emergencyPhone.trim() || null,
      medical_info: medicalInfo.trim() || null,
      updated_at: new Date().toISOString(),
    });

    if (privateInfoError) {
      setError(privateInfoError.message);
      setSaving(false);
      return;
    }

    // Re-fetch the full player_status row so the rest of the app has
    // consistent, up-to-date data (rating/games_played etc. included).
    const { data: refreshed } = await supabase
      .from("player_status")
      .select("*")
      .eq("id", player.id)
      .single();

    setSaving(false);
    if (refreshed) onSaved(refreshed as PlayerStatus);
    if (!isFirstTime) toast.success("Saved!");
  }

  return (
    <div>
      {isFirstTime ? (
        <>
          <h1>Welcome!</h1>
          <p style={{ color: "#475569" }}>
            Quick one-time setup — everything below is optional except your name.
          </p>
        </>
      ) : (
        <h1>My account</h1>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Avatar name={displayName} url={avatarUrl} size={72} />
          <div>
            <label htmlFor="photo-upload" style={{ marginTop: 0 }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {uploading ? "Uploading…" : "Change photo"}
              </span>
            </label>
            <input
              id="photo-upload"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handlePhotoChange}
              disabled={uploading}
            />
          </div>
        </div>

        <label>Full name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />

        {googleEmail && (
          <>
            <label>Signed in with</label>
            <p className="stat-meta" style={{ marginTop: 0 }}>
              {googleEmail} — useful to check on a shared or family device. Not editable here.
            </p>
          </>
        )}

        <label>Date of birth (optional)</label>
        <input
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input
            id="dob-visible"
            type="checkbox"
            checked={dobVisible}
            onChange={(e) => setDobVisible(e.target.checked)}
          />
          <label htmlFor="dob-visible" style={{ margin: 0, fontWeight: 400 }}>
            Show my date of birth to other club members
          </label>
        </div>
        <p className="stat-meta">Hidden from everyone else by default — only you (and admins) can see it either way.</p>

        <label>Leaderboard visibility</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="profile-visible"
            type="checkbox"
            checked={profileVisible}
            onChange={(e) => setProfileVisible(e.target.checked)}
          />
          <label htmlFor="profile-visible" style={{ margin: 0, fontWeight: 400 }}>
            Show me on the club leaderboard
          </label>
        </div>
        <p className="stat-meta">
          If you turn this off, you won't appear on the leaderboard and other members can't view your
          dashboard — but your matches still count and your own dashboard still works as normal. Admins
          can still see you when entering match results.
        </p>

        <label>Emergency contact name (optional)</label>
        <input
          type="text"
          value={emergencyName}
          onChange={(e) => setEmergencyName(e.target.value)}
          placeholder="e.g. a partner or family member"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
        <label>Emergency contact phone (optional)</label>
        <input
          type="tel"
          value={emergencyPhone}
          onChange={(e) => setEmergencyPhone(e.target.value)}
          placeholder="e.g. 07700 900000"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
        <p className="stat-meta">Only ever visible to club admins — never shown to other members.</p>

        <label>Essential Medical Information (optional)</label>
        <textarea
          value={medicalInfo}
          onChange={(e) => setMedicalInfo(e.target.value)}
          placeholder="Please include Medical Conditions, Allergies, Current Medications"
          rows={3}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontFamily: "inherit",
            fontSize: "1rem",
            resize: "vertical",
          }}
        />
        <p className="stat-meta">
          Only ever visible to club admins — never shown to other members. Important for us to know in case of
          an emergency on court.
        </p>

        {error && <p className="error">{error}</p>}

        <button disabled={saving || uploading} onClick={handleSave}>
          {saving ? "Saving…" : isFirstTime ? "Finish setup" : "Save changes"}
        </button>
      </div>

      {!isFirstTime && isPushSupported() && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Notifications</h2>
          <p className="stat-meta" style={{ marginTop: 0 }}>
            Get a push notification on this device when a new notice or event is posted.
          </p>
          <button
            disabled={pushBusy}
            onClick={handleTogglePush}
            style={
              pushSubscribed
                ? { marginTop: 0, background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }
                : { marginTop: 0 }
            }
          >
            {pushBusy ? "…" : pushSubscribed ? "Turn off notifications" : "Turn on notifications"}
          </button>
          {pushError && <p className="error">{pushError}</p>}

          {pushSubscribed && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <p className="stat-meta" style={{ marginTop: 0, marginBottom: 8, fontWeight: 700 }}>
                What to notify me about
              </p>
              {(
                [
                  { key: "notify_new_events" as const, label: "New events", value: notifyNewEvents, setter: setNotifyNewEvents },
                  { key: "notify_new_notices" as const, label: "New notices", value: notifyNewNotices, setter: setNotifyNewNotices },
                  { key: "notify_badge_earned" as const, label: "Earning a new badge", value: notifyBadgeEarned, setter: setNotifyBadgeEarned },
                  { key: "notify_rank_change" as const, label: "Entering/exiting the club Top 10", value: notifyRankChange, setter: setNotifyRankChange },
                ]
              ).map((c) => (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <input
                    id={c.key}
                    type="checkbox"
                    checked={c.value}
                    disabled={categorySaving === c.key}
                    onChange={() => handleToggleCategory(c.key, c.value, c.setter)}
                  />
                  <label htmlFor={c.key} style={{ margin: 0, fontWeight: 400 }}>
                    {c.label}
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isFirstTime && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Appearance</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="dark-mode" type="checkbox" checked={darkMode} disabled={darkModeSaving} onChange={handleToggleDarkMode} />
            <label htmlFor="dark-mode" style={{ margin: 0, fontWeight: 400 }}>
              Dark mode
            </label>
          </div>
          <p className="stat-meta">Follows your account across devices.</p>
        </div>
      )}

      {!isFirstTime && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Your data</h2>
          <p className="stat-meta" style={{ marginTop: 0 }}>
            Export your own match history as a spreadsheet.
          </p>
          <button
            disabled={exportingCsv}
            onClick={handleExportMatchHistory}
            style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
          >
            {exportingCsv ? "Preparing…" : "Export my match history (CSV)"}
          </button>

          <p className="stat-meta" style={{ marginTop: 14 }}>
            Or download everything Sideline holds about you as a single file.
          </p>
          <button
            disabled={exportingData}
            onClick={handleDownloadMyData}
            style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
          >
            {exportingData ? "Preparing…" : "Download my data"}
          </button>

          <p className="stat-meta" style={{ marginTop: 14 }}>
            Leaving the club? This clears your personal details and stops you signing back in. Your past match
            results stay on record since other members' stats depend on them.
          </p>
          <button
            disabled={deletingAccount}
            onClick={handleDeleteAccount}
            style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
          >
            {deletingAccount ? "Deleting…" : "Delete my account"}
          </button>
          {deleteError && <p className="error">{deleteError}</p>}
        </div>
      )}

      {!isFirstTime && (
        <div className="card" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {isAdmin && onTogglePreview && (
            <button
              onClick={onTogglePreview}
              style={{
                marginTop: 0,
                background: "transparent",
                color: "var(--navy-500)",
                border: "1px solid var(--border)",
              }}
            >
              {previewAsPlayer ? "Exit preview mode" : "Preview as a regular player"}
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              marginTop: 0,
              background: "transparent",
              color: "var(--danger)",
              border: "1px solid var(--border)",
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
