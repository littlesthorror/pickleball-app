import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Loads the Poppins font (used only for the small italic byline below the
// "Sideline" title) from Google Fonts on demand, rather than adding it to
// index.html globally — it's the only place in the app that uses it.
function usePoppinsFont() {
  useEffect(() => {
    const id = "poppins-italic-font";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@1,500&display=swap";
    document.head.appendChild(link);
  }, []);
}

export default function Login() {
  usePoppinsFont();

  // Magic-link email sign-in (2026-08-25) — an alternative to Google for
  // anyone who doesn't have or want to use a Gmail account. Nothing
  // downstream needed changing for this: InviteGate and
  // redeem_invite_code() already work off auth.uid() regardless of
  // provider, and redeem_invite_code() already falls back to the auth
  // email address when there's no full_name/name in the user's metadata
  // (which is exactly the case for a magic-link sign-in, vs. Google always
  // providing a name) — so a new member just starts out with their email
  // as their display name and can change it on the Profile page.
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function handleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function handleSendMagicLink() {
    if (!email.trim()) return;
    setSendingLink(true);
    setLinkError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSendingLink(false);
    if (error) {
      setLinkError(error.message);
      return;
    }
    setLinkSent(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "20vh" }}>
      <img
        src="/logo.png"
        alt=""
        onError={(e) => (e.currentTarget.style.display = "none")}
        style={{ height: 90, width: 90, objectFit: "contain", borderRadius: 16, marginBottom: 16 }}
      />
      <h1 style={{ marginBottom: 2, fontSize: "2.34rem" }}>Sideline</h1>
      <p
        style={{
          color: "#ff7a1a",
          fontFamily: "'Poppins', sans-serif",
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
          margin: "0 0 24px",
        }}
      >
        Huntingdon Pickleball
      </p>
      <button onClick={handleSignIn} style={{ width: "auto", padding: "12px 28px" }}>
        Sign in with Google
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, width: 260, margin: "20px 0" }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span className="stat-meta" style={{ margin: 0 }}>
          or
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {linkSent ? (
        <p className="stat-meta" style={{ maxWidth: 260, textAlign: "center" }}>
          Check <strong>{email.trim()}</strong> for a login link — it'll sign you straight in, no password
          needed.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 260 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendMagicLink();
            }}
          />
          <button
            disabled={sendingLink || !email.trim()}
            onClick={handleSendMagicLink}
            style={{ background: "transparent", color: "var(--navy-500)", border: "1px solid var(--border)" }}
          >
            {sendingLink ? "Sending…" : "Email me a login link"}
          </button>
          {linkError && <p className="error">{linkError}</p>}
        </div>
      )}
    </div>
  );
}
