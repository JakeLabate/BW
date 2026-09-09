import { useState } from "react";
import { fn } from "../lib/supabase";
import { useBrand } from "../lib/store";
import { SOURCE_LABEL } from "../lib/types";
import { Busy, Notice, timeAgo, useAction } from "../lib/ui";

export default function Collect() {
  const { brand, reload, runs } = useBrand();
  const b = brand!;

  return (
    <>
      <div className="head">
        <h1>Collect</h1>
        <p>
          Four ways in. Everything any of them finds arrives as a proposal, never as fact. You decide
          what is true on the Profile tab.
        </p>
      </div>

      <div className="grid two">
        <WebScrape brandId={b.id} defaultUrl={b.website_url ?? ""} onDone={reload} />
        <PasteText brandId={b.id} onDone={reload} />
        <Inference brandId={b.id} onDone={reload} />
        <div className="card">
          <h3>Customer inbox</h3>
          <p className="sub">
            Gmail, Instagram DM, Messenger and contact form messages are what the market gap loop
            reads. Import them on the Inbox tab.
          </p>
          <a href={`#/b/${b.id}/inbox`}>
            <button style={{ marginTop: 8 }}>Open the inbox</button>
          </a>
        </div>
      </div>

      {runs.length > 0 && (
        <>
          <div className="section-title">Collection history</div>
          <div className="card scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Pages</th>
                  <th>Proposed</th>
                  <th>Blocked</th>
                  <th className="right">When</th>
                </tr>
              </thead>
              <tbody>
                {runs
                  .filter((r) => r.kind.startsWith("collect") || r.kind === "infer")
                  .slice(0, 10)
                  .map((r) => {
                    const d = r.detail as { pages?: string[]; proposed?: number; pages_failed?: string[] };
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className={`pill ${r.status === "done" ? "green" : r.status === "failed" ? "red" : ""}`}>
                            {r.kind}
                          </span>
                        </td>
                        <td className="small muted">{d.pages?.length ?? 0}</td>
                        <td className="small">{d.proposed ?? 0}</td>
                        <td className="small muted">{d.pages_failed?.length ?? 0}</td>
                        <td className="right small muted">{timeAgo(r.started_at)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function WebScrape({ brandId, defaultUrl, onDone }: { brandId: string; defaultUrl: string; onDone: () => Promise<void> }) {
  const [url, setUrl] = useState(defaultUrl);
  const run = useAction(async () => {
    let u = url.trim();
    if (!u) throw new Error("Give me a URL to read.");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const r = await fn<{ pages_read: number; proposed: number; pages_failed: string[] }>("collect", {
      brand_id: brandId,
      url: u,
    });
    await onDone();
    return `Read ${r.pages_read} pages and proposed ${r.proposed} facts.${
      r.pages_failed.length ? ` ${r.pages_failed.length} pages would not load.` : ""
    }`;
  });

  return (
    <div className="card">
      <h3>Web scrape</h3>
      <p className="sub">
        Reads the site and up to seven of its most useful internal pages. Google Business, Yelp,
        Instagram and LinkedIn often block readers, so paste those instead.
      </p>
      <Notice kind="err">{run.error}</Notice>
      <Notice kind="ok">{run.done}</Notice>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="scrape-url">Start URL</label>
        <input id="scrape-url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" />
      </div>
      <button className="primary" onClick={() => run.run()} disabled={run.busy}>
        <Busy busy={run.busy}>Read the site</Busy>
      </button>
    </div>
  );
}

function PasteText({ brandId, onDone }: { brandId: string; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const run = useAction(async () => {
    if (text.trim().length < 40) throw new Error("Paste a bit more than that.");
    const r = await fn<{ proposed: number }>("collect", {
      brand_id: brandId,
      pasted_text: text,
      label: label.trim() || "Pasted text",
      kind: "paste",
    });
    setText("");
    await onDone();
    return `Proposed ${r.proposed} facts.`;
  });

  return (
    <div className="card">
      <h3>Owner input and pasted pages</h3>
      <p className="sub">
        Anything you can copy: a Google Business profile, a Yelp page, an old brochure, or just you
        typing out what the business does.
      </p>
      <Notice kind="err">{run.error}</Notice>
      <Notice kind="ok">{run.done}</Notice>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="paste-label">What is this</label>
        <input id="paste-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Google Business profile" />
      </div>
      <div className="field">
        <label htmlFor="paste-text">Text</label>
        <textarea id="paste-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or type here." />
      </div>
      <button className="primary" onClick={() => run.run()} disabled={run.busy}>
        <Busy busy={run.busy}>Extract facts</Busy>
      </button>
    </div>
  );
}

function Inference({ brandId, onDone }: { brandId: string; onDone: () => Promise<void> }) {
  const [logo, setLogo] = useState<string | null>(null);
  const [logoName, setLogoName] = useState("");
  const [posts, setPosts] = useState("");

  const run = useAction(async () => {
    if (!logo && posts.trim().length < 40) throw new Error("Give me a logo, a post history, or both.");
    const r = await fn<{ proposed: number; palette: string[] }>("infer", {
      brand_id: brandId,
      logo_data_url: logo,
      posts_text: posts || undefined,
    });
    await onDone();
    return `Proposed ${r.proposed} facts${r.palette?.length ? `, palette ${r.palette.join(" ")}` : ""}.`;
  });

  return (
    <div className="card">
      <h3>AI inference</h3>
      <p className="sub">
        Claude reads the logo file and the past post history, and infers the palette and the way this
        business actually writes. Voice facts come out at lower confidence on purpose.
      </p>
      <Notice kind="err">{run.error}</Notice>
      <Notice kind="ok">{run.done}</Notice>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="logo">Logo file<span className="hint">PNG, JPG or WebP, under about 4MB.</span></label>
        <input
          id="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => {
              setLogo(String(r.result));
              setLogoName(file.name);
            };
            r.readAsDataURL(file);
          }}
        />
        {logo && (
          <div className="row small muted" style={{ marginTop: 8 }}>
            <img src={logo} alt="" style={{ height: 34, borderRadius: 6, border: "1px solid var(--line)" }} />
            {logoName}
            <button className="ghost sm" onClick={() => { setLogo(null); setLogoName(""); }}>
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="posts">Past posts<span className="hint">One per paragraph. Ten is plenty.</span></label>
        <textarea id="posts" value={posts} onChange={(e) => setPosts(e.target.value)} placeholder="Paste the last several posts, separated by blank lines." />
      </div>
      <button className="primary" onClick={() => run.run()} disabled={run.busy}>
        <Busy busy={run.busy}>Infer identity and voice</Busy>
      </button>
      <p className="sub" style={{ marginTop: 10 }}>
        Source types: {Object.values(SOURCE_LABEL).join(", ")}.
      </p>
    </div>
  );
}
