import { useEffect } from "react";
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
      <h1 style={{ marginBottom: 2 }}>Sideline</h1>
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
        by Huntingdon Pickleball
      </p>
      <button onClick={handleSignIn} style={{ width: "auto", padding: "12px 28px" }}>
        Sign in with Google
      </button>
    </div>
  );
}
