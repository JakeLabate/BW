import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Busy, Notice, useAction } from "../lib/ui";

export default function SignIn() {
  const [email, setEmail] = useState("");

  const github = useAction(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;
  });

  const magic = useAction(async () => {
    if (!email.trim()) throw new Error("Enter your email first.");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;
    return "Check your email for the sign in link.";
  });

  return (
    <div className="center-page">
      <div className="signin">
        <div style={{ marginBottom: 22 }}>
          <div className="brandmark" style={{ fontSize: 26 }}>
            <span className="dot" style={{ width: 26, height: 26 }} />
            BrandWield
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Brand intelligence for small businesses. Collect what is true about a business, keep it
            in one structured record, and turn it into content that does not invent anything.
          </p>
        </div>

        <div className="card">
          <Notice kind="err">{github.error ?? magic.error}</Notice>
          <Notice kind="ok">{magic.done}</Notice>

          <button className="primary" style={{ width: "100%" }} onClick={() => github.run()} disabled={github.busy}>
            <Busy busy={github.busy}>Continue with GitHub</Busy>
          </button>

          <div className="row" style={{ margin: "16px 0 12px", gap: 10 }}>
            <hr style={{ flex: 1, margin: 0 }} />
            <span className="muted small">or</span>
            <hr style={{ flex: 1, margin: 0 }} />
          </div>

          <div className="field">
            <label htmlFor="email">Email a sign in link</label>
            <input
              id="email"
              type="email"
              value={email}
              placeholder="you@business.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && magic.run()}
            />
          </div>
          <button style={{ width: "100%" }} onClick={() => magic.run()} disabled={magic.busy}>
            <Busy busy={magic.busy}>Send the link</Busy>
          </button>
        </div>

        <p className="small muted" style={{ marginTop: 14 }}>
          Jake Labate, SEO Consultant
        </p>
      </div>
    </div>
  );
}
