import { useMemo, useState } from "react";
import { fn } from "../lib/supabase";
import { useBrand } from "../lib/store";
import { SOURCE_LABEL, type Fact, type Source } from "../lib/types";
import { Busy, Empty, Notice, timeAgo, useAction } from "../lib/ui";

export default function Sources() {
  const { brand, sources, facts, runs, defs, reload } = useBrand();
  const b = brand!;
  const [adding, setAdding] = useState(false);

  const factsBySource = useMemo(() => {
    const map = new Map<string, Fact[]>();
    for (const f of facts) {
      const k = f.source_id ?? "manual";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return map;
  }, [facts]);

  const labelOf = useMemo(() => new Map(defs.map((d) => [d.key, d.label])), [defs]);
  const manual = factsBySource.get("manual") ?? [];

  return (
    <>
      <div className="head">
        <h1>Sources</h1>
        <p>
          Where every value in the profile came from, and when it was collected. Nothing enters the
          brand record without a source attached to it.
        </p>
      </div>

      <div className="row between" style={{ marginBottom: 16 }}>
        <div className="small muted">
          {sources.length} {sources.length === 1 ? "source" : "sources"} · {facts.length} values collected
        </div>
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Collect from a new source"}
        </button>
      </div>

      {adding && (
        <div className="grid two" style={{ marginBottom: 26 }}>
          <WebScrape brandId={b.id} defaultUrl={b.website_url ?? ""} onDone={reload} />
          <PasteText brandId={b.id} onDone={reload} />
          <Inference brandId={b.id} onDone={reload} />
          <div className="card">
            <h3>Customer inbox</h3>
            <p className="sub">
              Customer messages are a source too, but they feed the market gap loop rather than the
              brand record.
            </p>
            <a href={`#/b/${b.id}/inbox`}>
              <button style={{ marginTop: 8 }}>Open the inbox</button>
            </a>
          </div>
        </div>
      )}

      {sources.length === 0 && manual.length === 0 ? (
        <Empty title="Nothing collected yet">
          <p className="tight">Read the website, paste a page, or let Claude read the logo and past posts.</p>
        </Empty>
      ) : (
        <div className="stack">
          {sources.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              facts={factsBySource.get(s.id) ?? []}
              labelOf={labelOf}
            />
          ))}
          {manual.length > 0 && (
            <div className="card pad-sm">
              <div className="row between">
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="pill violet">Typed in</span>
                    <strong>Entered by hand</strong>
                  </div>
                  <div className="sub">Values you typed straight into the profile.</div>
                </div>
                <span className="small muted">{manual.length} values</span>
              </div>
              <div className="chips" style={{ marginTop: 10 }}>
                {[...new Set(manual.map((f) => f.field_key))].map((k) => (
                  <span className="pill" key={k}>
                    {labelOf.get(k) ?? k}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {runs.length > 0 && (
        <>
          <div className="section-title">Collection runs</div>
          <div className="card scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th className="right">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const d = r.detail as {
                    pages?: string[];
                    proposed?: number;
                    pages_failed?: string[];
                    drafted?: number;
                    gaps_found?: number;
                  };
                  return (
                    <tr key={r.id}>
                      <td className="mono">{r.kind}</td>
                      <td>
                        <span className={`pill ${r.status === "done" ? "green" : r.status === "failed" ? "red" : ""}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="small muted">
                        {r.error ??
                          ([
                            d.pages?.length ? `${d.pages.length} pages read` : null,
                            d.proposed != null ? `${d.proposed} values proposed` : null,
                            d.gaps_found != null ? `${d.gaps_found} gaps` : null,
                            d.drafted != null ? `${d.drafted} drafts` : null,
                            d.pages_failed?.length ? `${d.pages_failed.length} blocked` : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "-")}
                      </td>
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

function SourceCard({
  source,
  facts,
  labelOf,
}: {
  source: Source;
  facts: Fact[];
  labelOf: Map<string, string>;
}) {
  const confirmed = facts.filter((f) => f.status === "confirmed").length;
  const pending = facts.filter((f) => f.status === "proposed").length;
  const pages = (source.config?.pages as string[] | undefined) ?? [];
  const failed = (source.config?.failed as string[] | undefined) ?? [];

  return (
    <div className="card pad-sm">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill violet">{SOURCE_LABEL[source.kind]}</span>
            <strong>{source.label}</strong>
          </div>
          {source.url && (
            <div className="sub">
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.url}
              </a>
            </div>
          )}
        </div>
        <div className="right small muted">
          <div>{timeAgo(source.last_run_at ?? source.created_at)}</div>
          <div>
            {confirmed} confirmed
            {pending > 0 ? `, ${pending} waiting` : ""}
          </div>
        </div>
      </div>

      {facts.length > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {[...new Set(facts.map((f) => f.field_key))].map((k) => (
            <span className="pill" key={k}>
              {labelOf.get(k) ?? k}
            </span>
          ))}
        </div>
      )}

      {(pages.length > 1 || failed.length > 0) && (
        <details style={{ marginTop: 10 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            {pages.length} pages read{failed.length ? `, ${failed.length} blocked` : ""}
          </summary>
          <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {pages.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {failed.map((p) => (
              <li key={p} style={{ color: "var(--red)" }}>
                {p} (blocked)
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ collectors */

function WebScrape({ brandId, defaultUrl, onDone }: { brandId: string; defaultUrl: string; onDone: () => Promise<void> }) {
  const [url, setUrl] = useState(defaultUrl);
  const run = useAction(async () => {
    let u = url.trim();
    if (!u) throw new Error("Give me a URL to read.");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const r = await fn<{
      pages_read: number;
      proposed: number;
      pages_failed: string[];
      modules_suggested?: Record<string, number>;
    }>("collect", { brand_id: brandId, url: u });
    await onDone();
    const extra = Object.entries(r.modules_suggested ?? {});
    return (
      `Read ${r.pages_read} pages and proposed ${r.proposed} values.` +
      (r.pages_failed.length ? ` ${r.pages_failed.length} pages would not load.` : "") +
      (extra.length
        ? ` Found material for modules you have not added yet: ${extra
            .map(([k, n]) => `${k} (${n})`)
            .join(", ")}.`
        : "")
    );
  });

  return (
    <div className="card">
      <h3>Web scrape</h3>
      <p className="sub">
        Reads the site and up to seven of its most useful internal pages. Google Business, Yelp,
        Instagram and LinkedIn block automated readers, so paste those instead.
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
    const r = await fn<{ proposed: number; modules_suggested?: Record<string, number> }>("collect", {
      brand_id: brandId,
      pasted_text: text,
      label: label.trim() || "Pasted text",
      kind: "paste",
    });
    setText("");
    await onDone();
    const extra = Object.entries(r.modules_suggested ?? {});
    return (
      `Proposed ${r.proposed} values.` +
      (extra.length
        ? ` Material for modules you have not added yet: ${extra.map(([k, n]) => `${k} (${n})`).join(", ")}.`
        : "")
    );
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
        <Busy busy={run.busy}>Extract values</Busy>
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
    return `Proposed ${r.proposed} values${r.palette?.length ? `, palette ${r.palette.join(" ")}` : ""}.`;
  });

  return (
    <div className="card">
      <h3>AI inference</h3>
      <p className="sub">
        Claude reads the logo file and the past post history, and infers the palette and the way this
        business actually writes. Voice values come out at lower confidence on purpose.
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
    </div>
  );
}
