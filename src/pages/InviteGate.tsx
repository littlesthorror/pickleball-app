import { useState } from "react";
import { supabase } from "../supabaseClient";

// Shown after a successful Google sign-in but before a players row exists
// for that account — new members need a code from an admin (see the
// "Invite code" section on the Admins screen) before they can join. This
// replaces the old behaviour where any Google account was auto-enrolled.
export default function InviteGate({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);

    const { data, error } = await supabase.rpc("redeem_invite_code", { input_code: code.trim() });

    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }

    if (!data) {
      setError("That code doesn't match — check with a club admin and try again.");
      setSubmitting(false);
      return;
    }

    onJoined();
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h1 style={{ marginTop: 0 }}>You're invited!</h1>
      <p className="stat-meta">Enter the invite code a club admin gave you to finish joining.</p>

      <label style={{ marginTop: 16 }}>Invite code</label>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. A1B2C3D4"
        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />

      {error && <p className="error">{error}</p>}

      <button disabled={submitting || !code.trim()} onClick={handleSubmit}>
        {submitting ? "Checking…" : "Join the club"}
      </button>

      <p className="stat-meta" style={{ marginTop: 16, textAlign: "center" }}>
        Signed in with the wrong account?{" "}
        <span className="link-action" role="button" tabIndex={0} onClick={() => supabase.auth.signOut()}>
          Sign out
        </span>
      </p>
    </div>
  );
}
