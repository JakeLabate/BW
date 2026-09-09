import { useMemo, useState } from "react";
import { fn, supabase } from "../lib/supabase";
import { useBrand } from "../lib/store";
import type { Fact, Message, Source, SourceKind } from "../lib/types";
import { Busy, Empty, Notice, timeAgo, useAction } from "../lib/ui";

const KIND_LABEL: Record<SourceKind, string> = {
  web_scrape: "Website",
  owner_input: "Pasted text",
  ai_inference: "Logo and post history",
  customer_inbox: "Customer inbox",
};

const KIND_BLURB: Record<SourceKind, string> = {
  web_scrape: "Reads a site and its most useful internal pages on a schedule you set.",
  owner_input: "Anything you can copy: a Google Business profile, a Yelp page, an old brochure.",
  ai_inference: "Claude reads the logo file and past posts, and infers palette and writing voice.",
  customer_inbox: "Gmail, Instagram DM, Messenger and contact form messages. Feeds the market gap loop.",
};

const SCHEDULES = [
  ["manual", "Only when I run it"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
] as const;

export default function Integrations() {
  const { brand, sources, facts, messages, runs, defs, modules, reload } = useBrand();
  const b = brand!;
  const [adding, setAdding] = useState<SourceKind | null>(null);

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
  const hasInbox = sources.some((s) => s.kind === "customer_inbox");
  const hasInference = sources.some((s) => s.kind === "ai_inference");

  const create = useAction(async (kind: SourceKind, name: string, url: string | null) => {
    const { error } = await supabase.from("sources").insert({
      brand_id: b.id,
      kind,
      name,
      label: name,
      url,
      config: {},
      status: "active",
      schedule: "manual",
      scope: [],
    });
    if (error) throw error;
    setAdding(null);
    await reload();
  });

  return (
    <>
      <div className="head">
        <h1>Integrations</h1>
        <p>
          Every place BrandWield gets information from, and the settings that govern each one: what
          it is allowed to write to, how often it runs, and how much it is trusted.
        </p>
      </div>

      <Notice kind="err">{create.error}</Notice>

      <div className="row" style={{ marginBottom: 18, gap: 8 }}>
        {(["web_scrape", "owner_input", "ai_inference", "customer_inbox"] as SourceKind[]).map((k) => {
          const singleton =
            (k === "customer_inbox" && hasInbox) || (k === "ai_inference" && hasInference);
          return (
            <button key={k} onClick={() => setAdding(k)} disabled={singleton}>
              {singleton ? `${KIND_LABEL[k]} connected` : `Add ${KIND_LABEL[k].toLowerCase()}`}
            </button>
          );
        })}
      </div>

      {adding && (
        <NewIntegration
          kind={adding}
          defaultUrl={b.website_url ?? ""}
          busy={create.busy}
          onCancel={() => setAdding(null)}
          onCreate={(name, url) => create.run(adding, name, url)}
        />
      )}

      {sources.length === 0 ? (
        <Empty title="Nothing connected yet">
          <p className="tight">Add the website first. It is the fastest way to fill a profile.</p>
        </Empty>
      ) : (
        <div className="stack">
          {sources.map((s) => (
            <IntegrationCard
              key={s.id}
              source={s}
              facts={factsBySource.get(s.id) ?? []}
              messages={messages.filter((m) => m.source_id === s.id || s.kind === "customer_inbox")}
              labelOf={labelOf}
              modules={modules}
              brandId={b.id}
              defaultUrl={b.website_url ?? ""}
              onDone={reload}
            />
          ))}
        </div>
      )}

      {manual.length > 0 && (
        <div className="card pad-sm" style={{ marginTop: 12 }}>
          <div className="row between">
            <div>
              <div className="row" style={{ gap: 8 }}>
                <span className="pill">Not an integration</span>
                <strong>Typed in by hand</strong>
              </div>
              <div className="sub">Values you entered straight into My Brand.</div>
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

      {runs.length > 0 && (
        <>
          <div className="section-title">Run history</div>
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
                  const d = r.detail as Record<string, unknown>;
                  const bits = [
                    Array.isArray(d.pages) ? `${(d.pages as string[]).length} pages read` : null,
                    typeof d.proposed === "number" ? `${d.proposed} values` : null,
                    typeof d.auto_confirmed === "number" && d.auto_confirmed
                      ? `${d.auto_confirmed} auto confirmed`
                      : null,
                    typeof d.below_confidence_floor === "number" && d.below_confidence_floor
                      ? `${d.below_confidence_floor} below floor`
                      : null,
                    typeof d.gaps_found === "number" ? `${d.gaps_found} market gaps` : null,
                    typeof d.drafted === "number" ? `${d.drafted} drafts` : null,
                  ].filter(Boolean);
                  return (
                    <tr key={r.id}>
                      <td className="mono">{r.kind}</td>
                      <td>
                        <span className={`pill ${r.status === "done" ? "green" : r.status === "failed" ? "red" : ""}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="small muted">{r.error ?? (bits.join(", ") || "-")}</td>
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

/* -------------------------------------------------------------- new one */

function NewIntegration({
  kind,
  defaultUrl,
  busy,
  onCancel,
  onCreate,
}: {
  kind: SourceKind;
  defaultUrl: string;
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string, url: string | null) => void;
}) {
  const [name, setName] = useState(KIND_LABEL[kind]);
  const [url, setUrl] = useState(kind === "web_scrape" ? defaultUrl : "");

  return (
    <div className="card" style={{ marginBottom: 20, borderColor: "var(--violet-line)" }}>
      <h3>Connect {KIND_LABEL[kind].toLowerCase()}</h3>
      <p className="sub">{KIND_BLURB[kind]}</p>
      <div className="inline-form" style={{ marginTop: 12 }}>
        <div>
          <label htmlFor="in">Name it</label>
          <input id="in" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {kind === "web_scrape" && (
          <div>
            <label htmlFor="iu">URL</label>
            <input id="iu" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" />
          </div>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            let u = url.trim();
            if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
            onCreate(name.trim() || KIND_LABEL[kind], u || null);
          }}
        >
          <Busy busy={busy}>Connect</Busy>
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ one card */

function IntegrationCard({
  source,
  facts,
  messages,
  labelOf,
  modules,
  brandId,
  defaultUrl,
  onDone,
}: {
  source: Source;
  facts: Fact[];
  messages: Message[];
  labelOf: Map<string, string>;
  modules: { group_key: string; label: string; enabled: boolean }[];
  brandId: string;
  defaultUrl: string;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState<"none" | "settings" | "run">("none");
  const confirmed = facts.filter((f) => f.status === "confirmed").length;
  const pending = facts.filter((f) => f.status === "proposed").length;
  const scope = (source.scope ?? []) as string[];

  const run = useAction(async (payload: Record<string, unknown>) => {
    const endpoint = source.kind === "ai_inference" ? "infer" : "collect";
    const r = await fn<Record<string, unknown>>(endpoint, {
      brand_id: brandId,
      source_id: source.id,
      ...payload,
    });
    await onDone();
    const parts = [
      typeof r.pages_read === "number" ? `${r.pages_read} pages read` : null,
      typeof r.proposed === "number" ? `${r.proposed} values captured` : null,
      typeof r.below_confidence_floor === "number" && r.below_confidence_floor
        ? `${r.below_confidence_floor} dropped below the confidence floor`
        : null,
    ].filter(Boolean);
    return parts.join(", ") || "Done.";
  });

  const mine = useAction(async () => {
    const r = await fn<{ gaps_found: number; messages_read: number }>("mine", { brand_id: brandId });
    await onDone();
    return `Read ${r.messages_read} messages and found ${r.gaps_found} market gaps.`;
  });

  return (
    <div className="card pad-sm">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill violet">{KIND_LABEL[source.kind]}</span>
            <strong>{source.name ?? source.label}</strong>
            {source.status === "paused" && <span className="pill">Paused</span>}
          </div>
          <div className="sub" style={{ marginTop: 3 }}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.url}
              </a>
            ) : (
              KIND_BLURB[source.kind]
            )}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {source.schedule === "manual" ? "Runs only when you say so" : `Runs ${source.schedule}`}
            {" · "}
            {source.run_count ?? 0} {(source.run_count ?? 0) === 1 ? "run" : "runs"}
            {" · last "}
            {timeAgo(source.last_run_at)}
            {scope.length > 0 && ` · writes to ${scope.length} modules only`}
            {source.auto_confirm && " · auto confirms"}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="sm" onClick={() => setOpen(open === "settings" ? "none" : "settings")}>
            Settings
          </button>
          <button className="primary sm" onClick={() => setOpen(open === "run" ? "none" : "run")}>
            {source.kind === "customer_inbox" ? "Messages" : "Capture now"}
          </button>
        </div>
      </div>

      <Notice kind="err">{run.error ?? mine.error}</Notice>
      <Notice kind="ok">{run.done ?? mine.done}</Notice>

      {facts.length > 0 && source.kind !== "customer_inbox" && (
        <div className="chips" style={{ marginTop: 10 }}>
          <span className="small muted" style={{ marginRight: 4 }}>
            {confirmed} confirmed{pending ? `, ${pending} waiting` : ""}:
          </span>
          {[...new Set(facts.map((f) => f.field_key))].slice(0, 12).map((k) => (
            <span className="pill" key={k}>
              {labelOf.get(k) ?? k}
            </span>
          ))}
        </div>
      )}

      {open === "settings" && (
        <IntegrationSettings source={source} modules={modules} onDone={onDone} />
      )}

      {open === "run" && source.kind === "web_scrape" && (
        <div className="inline-form" style={{ marginTop: 14 }}>
          <div>
            <label>URL to read</label>
            <input type="text" defaultValue={source.url ?? defaultUrl} id={`u-${source.id}`} />
          </div>
          <button
            className="primary"
            disabled={run.busy}
            onClick={() => {
              const el = document.getElementById(`u-${source.id}`) as HTMLInputElement;
              let u = el.value.trim();
              if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
              run.run({ url: u });
            }}
          >
            <Busy busy={run.busy}>Capture now</Busy>
          </button>
        </div>
      )}

      {open === "run" && source.kind === "owner_input" && <PasteRun run={run} />}
      {open === "run" && source.kind === "ai_inference" && <InferRun run={run} />}
      {open === "run" && source.kind === "customer_inbox" && (
        <InboxPanel source={source} brandId={brandId} messages={messages} mine={mine} onDone={onDone} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- settings */

function IntegrationSettings({
  source,
  modules,
  onDone,
}: {
  source: Source;
  modules: { group_key: string; label: string; enabled: boolean }[];
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(source.name ?? source.label);
  const [url, setUrl] = useState(source.url ?? "");
  const [schedule, setSchedule] = useState<Source["schedule"]>(source.schedule ?? "manual");
  const [status, setStatus] = useState<Source["status"]>(source.status ?? "active");
  const [scope, setScope] = useState<string[]>((source.scope ?? []) as string[]);
  const [floor, setFloor] = useState(String(source.min_confidence ?? 0));
  const [autoConfirm, setAutoConfirm] = useState(!!source.auto_confirm);

  const save = useAction(async () => {
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    const { error } = await supabase
      .from("sources")
      .update({
        name: name.trim() || source.label,
        label: name.trim() || source.label,
        url: u || null,
        schedule,
        status,
        scope,
        min_confidence: Number(floor) || 0,
        auto_confirm: autoConfirm,
      })
      .eq("id", source.id);
    if (error) throw error;
    await onDone();
    return "Settings saved.";
  });

  const remove = useAction(async () => {
    const { error } = await supabase.from("sources").delete().eq("id", source.id);
    if (error) throw error;
    await onDone();
  });

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
      <Notice kind="err">{save.error ?? remove.error}</Notice>
      <Notice kind="ok">{save.done}</Notice>

      <div className="grid two">
        <div className="field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {source.kind === "web_scrape" && (
          <div className="field">
            <label>URL</label>
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>
            When it captures
            <span className="hint">
              Stored as intent. Automatic runs are not wired up yet, so anything other than manual
              shows as due rather than firing on its own.
            </span>
          </label>
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as Source["schedule"])}>
            {SCHEDULES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Source["status"])}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>

      {source.kind !== "customer_inbox" && (
        <>
          <div className="field">
            <label>
              What it may capture
              <span className="hint">
                Nothing selected means every module this business uses. Pick some to keep an
                integration in its lane.
              </span>
            </label>
            <div className="chips">
              {modules.map((m) => {
                const on = scope.includes(m.group_key);
                return (
                  <button
                    key={m.group_key}
                    className={on ? "sm ok" : "sm"}
                    onClick={() =>
                      setScope((cur) =>
                        cur.includes(m.group_key)
                          ? cur.filter((k) => k !== m.group_key)
                          : [...cur, m.group_key],
                      )
                    }
                  >
                    {m.label}
                    {!m.enabled && " (off)"}
                  </button>
                );
              })}
              {scope.length > 0 && (
                <button className="ghost sm" onClick={() => setScope([])}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="grid two">
            <div className="field">
              <label>
                Confidence floor
                <span className="hint">Values the model is less sure of than this are discarded.</span>
              </label>
              <select value={floor} onChange={(e) => setFloor(e.target.value)}>
                <option value="0">Keep everything</option>
                <option value="0.5">0.5 and above</option>
                <option value="0.7">0.7 and above</option>
                <option value="0.9">0.9 and above, stated outright</option>
              </select>
            </div>
            <div className="field">
              <label>
                Trust level
                <span className="hint">
                  Auto confirm skips your review. Sensible for your own website, reckless for
                  inference.
                </span>
              </label>
              <select value={autoConfirm ? "auto" : "review"} onChange={(e) => setAutoConfirm(e.target.value === "auto")}>
                <option value="review">Everything waits for my review</option>
                <option value="auto">Confirm automatically</option>
              </select>
            </div>
          </div>
        </>
      )}

      <div className="row">
        <button className="primary" onClick={() => save.run()} disabled={save.busy}>
          <Busy busy={save.busy}>Save settings</Busy>
        </button>
        <button className="ghost danger" onClick={() => remove.run()} disabled={remove.busy}>
          Disconnect
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
        Disconnecting removes the integration. Values it already captured stay in the profile, with
        their history intact.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- run panels */

type Runner = ReturnType<typeof useAction<[Record<string, unknown>]>>;

function PasteRun({ run }: { run: Runner }) {
  const [text, setText] = useState("");
  return (
    <div style={{ marginTop: 14 }}>
      <div className="field">
        <label>Paste the material</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="A Google Business profile, a Yelp page, an old brochure, or just what the business does." />
      </div>
      <button
        className="primary"
        disabled={run.busy}
        onClick={() => run.run({ pasted_text: text, kind: "paste" })}
      >
        <Busy busy={run.busy}>Capture now</Busy>
      </button>
    </div>
  );
}

function InferRun({ run }: { run: Runner }) {
  const [logo, setLogo] = useState<string | null>(null);
  const [posts, setPosts] = useState("");
  return (
    <div style={{ marginTop: 14 }}>
      <div className="field">
        <label>Logo file</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => setLogo(String(r.result));
            r.readAsDataURL(file);
          }}
        />
        {logo && <img src={logo} alt="" style={{ height: 34, marginTop: 8, borderRadius: 6, border: "1px solid var(--line)" }} />}
      </div>
      <div className="field">
        <label>
          Past posts<span className="hint">One per paragraph. Ten is plenty.</span>
        </label>
        <textarea value={posts} onChange={(e) => setPosts(e.target.value)} />
      </div>
      <button
        className="primary"
        disabled={run.busy}
        onClick={() => run.run({ logo_data_url: logo, posts_text: posts || undefined })}
      >
        <Busy busy={run.busy}>Capture now</Busy>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- inbox */

const CHANNELS = ["gmail", "instagram dm", "messenger", "contact form", "sms", "phone note"];

function InboxPanel({
  source,
  brandId,
  messages,
  mine,
  onDone,
}: {
  source: Source;
  brandId: string;
  messages: Message[];
  mine: { run: () => void; busy: boolean };
  onDone: () => Promise<void>;
}) {
  const [channel, setChannel] = useState("gmail");
  const [bulk, setBulk] = useState("");

  const importBulk = useAction(async () => {
    const blocks = bulk.split(/\n\s*\n/).map((t) => t.trim()).filter((t) => t.length > 3);
    if (!blocks.length) throw new Error("Paste at least one message.");
    const rows = blocks.map((block) => {
      const m = block.match(/^\s*(?:from:\s*)?([^\n]{1,80}?)\s*\n([\s\S]+)$/i);
      const looksLikeSender = m && m[1].length < 60 && !/[.!?]$/.test(m[1]);
      return {
        brand_id: brandId,
        source_id: source.id,
        channel,
        sender: looksLikeSender ? m![1].replace(/^from:\s*/i, "").trim() : null,
        body: looksLikeSender ? m![2].trim() : block,
      };
    });
    const { error } = await supabase.from("messages").insert(rows);
    if (error) throw error;
    setBulk("");
    await onDone();
    return `Imported ${rows.length} messages.`;
  });

  const drop = useAction(async (id: string) => {
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) throw error;
    await onDone();
  });

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
      <Notice kind="err">{importBulk.error ?? drop.error}</Notice>
      <Notice kind="ok">{importBulk.done}</Notice>

      <div className="grid two">
        <div className="field">
          <label>Channel</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>
          Paste messages
          <span className="hint">
            One per block, blank line between. Optional first line is the sender.
          </span>
        </label>
        <textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={"Sarah M\nDo you do same day callouts on weekends?\n\nTom\nWhat would you charge to service two boilers at once?"}
        />
      </div>

      <div className="row">
        <button className="primary" onClick={() => importBulk.run()} disabled={importBulk.busy}>
          <Busy busy={importBulk.busy}>Import</Busy>
        </button>
        <button onClick={() => mine.run()} disabled={mine.busy || messages.length === 0}>
          <Busy busy={mine.busy}>Find market gaps</Busy>
        </button>
      </div>

      {messages.length > 0 && (
        <div className="scroll-x" style={{ marginTop: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>From</th>
                <th>Channel</th>
                <th>Message</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {messages.slice(0, 50).map((m) => (
                <tr key={m.id}>
                  <td className="small">{m.sender ?? <span className="muted">unknown</span>}</td>
                  <td>
                    <span className="pill">{m.channel}</span>
                  </td>
                  <td>{m.body}</td>
                  <td className="right">
                    <button className="ghost sm danger" onClick={() => drop.run(m.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
