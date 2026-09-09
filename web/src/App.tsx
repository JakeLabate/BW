import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { BrandProvider, go, openGaps, useBrand, useHashRoute } from "./lib/store";
import type { Brand } from "./lib/types";
import { Notice, useAction, Busy } from "./lib/ui";

import SignIn from "./screens/SignIn";
import Brands from "./screens/Brands";
import Dashboard from "./screens/Dashboard";
import Collect from "./screens/Collect";
import Profile from "./screens/Profile";
import Gaps from "./screens/Gaps";
import Inbox from "./screens/Inbox";
import Generate from "./screens/Generate";
import Queue from "./screens/Queue";
import Settings from "./screens/Settings";
import Account from "./screens/Account";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const path = useHashRoute();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <div className="center-page">
        <span className="spin" />
      </div>
    );
  }

  if (!session) return <SignIn />;

  const brandMatch = path.match(/^\/b\/([0-9a-f-]{36})(\/[a-z]*)?(\?.*)?$/i);

  return (
    <div className="shell">
      <TopBar email={session.user.email ?? ""} brandId={brandMatch?.[1]} />
      {brandMatch ? (
        <BrandProvider brandId={brandMatch[1]}>
          <BrandShell tab={(brandMatch[2] ?? "/").replace("/", "") || "home"} />
        </BrandProvider>
      ) : path.startsWith("/account") ? (
        <main>
          <Account />
        </main>
      ) : (
        <main>
          <Brands />
        </main>
      )}
    </div>
  );
}

function TopBar({ email, brandId }: { email: string; brandId?: string }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  useEffect(() => {
    supabase
      .from("brands")
      .select("*")
      .order("created_at")
      .then(({ data }) => setBrands((data as Brand[]) ?? []));
  }, [brandId]);

  const signOut = useAction(async () => {
    await supabase.auth.signOut();
    go("/");
  });

  return (
    <header className="topbar">
      <a className="brandmark" href="#/">
        <span className="dot" />
        BrandWield
      </a>
      {brands.length > 0 && (
        <select
          className="brand-select"
          value={brandId ?? ""}
          onChange={(e) => go(e.target.value ? `/b/${e.target.value}` : "/")}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      <div className="spacer" />
      <a className="small muted" href="#/account" style={{ textDecoration: "none" }}>
        {email}
      </a>
      <button className="ghost sm" onClick={() => signOut.run()}>
        <Busy busy={signOut.busy}>Sign out</Busy>
      </button>
    </header>
  );
}

const TABS = [
  ["home", "Overview"],
  ["collect", "Collect"],
  ["profile", "Profile"],
  ["gaps", "Gaps"],
  ["inbox", "Inbox"],
  ["generate", "Generate"],
  ["queue", "Queue"],
  ["settings", "Settings"],
] as const;

function BrandShell({ tab }: { tab: string }) {
  const { brand, loading, error, facts, gaps, content, messages } = useBrand();

  if (loading && !brand) {
    return (
      <main>
        <div className="wrap">
          <span className="spin" />
        </div>
      </main>
    );
  }
  if (!brand) {
    return (
      <main>
        <div className="wrap">
          <Notice kind="err">{error ?? "That brand does not exist, or is not yours."}</Notice>
          <a href="#/">Back to brands</a>
        </div>
      </main>
    );
  }

  const counts: Record<string, { n: number; hot?: boolean }> = {
    profile: { n: facts.filter((f) => f.status === "proposed").length, hot: true },
    gaps: { n: openGaps(gaps).length, hot: true },
    inbox: { n: messages.length },
    queue: { n: content.filter((c) => c.status !== "published" && c.status !== "archived").length },
  };

  const Screen = {
    home: Dashboard,
    collect: Collect,
    profile: Profile,
    gaps: Gaps,
    inbox: Inbox,
    generate: Generate,
    queue: Queue,
    settings: Settings,
  }[tab] ?? Dashboard;

  return (
    <>
      <nav className="nav">
        {TABS.map(([k, label]) => {
          const c = counts[k];
          return (
            <a key={k} className={tab === k ? "on" : ""} href={`#/b/${brand.id}${k === "home" ? "" : `/${k}`}`}>
              {label}
              {c && c.n > 0 && <span className={`count${c.hot ? " hot" : ""}`}>{c.n}</span>}
            </a>
          );
        })}
      </nav>
      <main>
        <div className="wrap">
          {error && <Notice kind="err">{error}</Notice>}
          <Screen />
        </div>
      </main>
    </>
  );
}
