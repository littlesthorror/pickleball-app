import { useState } from "react";
import type { ChangeEvent } from "react";
import { supabase } from "../supabaseClient";
import Avatar from "../components/Avatar";
import type { PlayerStatus } from "../types";

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
  const [displayName, setDisplayName] = useState(player.display_name);
  const [dob, setDob] = useState(player.date_of_birth ?? "");
  const [dobVisible, setDobVisible] = useState(player.date_of_birth_visible);
  const [profileVisible, setProfileVisible] = useState(player.profile_visible);
  const [avatarUrl, setAvatarUrl] = useState(player.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${player.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });

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

    // Re-fetch the full player_status row so the rest of the app has
    // consistent, up-to-date data (rating/games_played etc. included).
    const { data: refreshed } = await supabase
      .from("player_status")
      .select("*")
      .eq("id", player.id)
      .single();

    setSaving(false);
    if (refreshed) onSaved(refreshed as PlayerStatus);
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

        {error && <p className="error">{error}</p>}

        <button disabled={saving || uploading} onClick={handleSave}>
          {saving ? "Saving…" : isFirstTime ? "Finish setup" : "Save changes"}
        </button>
      </div>

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
