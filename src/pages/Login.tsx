import { supabase } from "../supabaseClient";

export default function Login() {
  async function handleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "20vh" }}>
      <img
        src="/logo.png"
        alt=""
        onError={(e) => (e.currentTarget.style.display = "none")}
        style={{ height: 90, width: 90, objectFit: "contain", borderRadius: 16, marginBottom: 16 }}
      />
      <h1 style={{ marginBottom: 4 }}>GhostShot</h1>
      <p className="stat-meta" style={{ marginBottom: 24 }}>Huntingdon Pickleball</p>
      <button onClick={handleSignIn} style={{ width: "auto", padding: "12px 28px" }}>
        Sign in with Google
      </button>
    </div>
  );
}
