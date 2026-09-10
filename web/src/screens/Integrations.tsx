import { useMemo, useState } from "react";
import { fn, supabase, SUPABASE_URL } from "../lib/supabase";
import { useBrand } from "../lib/store";
import type {
  Fact,
  Message,
  ProviderCategory,
  Source,
  SourceProvider,
} from "../lib/types";
import { CATEGORY_BLURB, CATEGORY_LABEL, INGEST_LABEL } from "../lib/types";
import { Busy, CopyButton, Empty, Notice, timeAgo, useAction } from "../lib/ui";

const CATEGORY_ORDER: ProviderCategory[] = ["web", "inbox", "social", "reviews", "owner", "ai"];

const MODES = [
  ["rules", "Rules only, no AI"],
  ["assisted", "Rules first, AI for the rest"],
  ["ai", "AI only"],
] as const;

const SCHEDULES = [
  ["manual", "Only when I run it"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
] as const;

const ingestUrl = (token: string) => `${SUPABASE_URL}/functions/v1/ingest?t=${token}`;

export default function Integrations() {
  const { brand, sources, providers, facts, messages, runs, defs, modules, reload } = useBrand();
  const b = brand!;
  const [connecting, setConnecting] = useState<SourceProvider | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const providerOf = useMemo(
    () => new Map(providers.map((p) => [p.key, p])),
    [providers],
  );

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
  const connected = useMemo(() => new Set(sources.map((s) => s.provider)), [sources]);

  const create = useAction(async (p: SourceProvider, name: string, url: string | null) => {
    const { error } = await supabase.from("sources").insert({
      brand_id: b.id,
      kind: p.kind,
      provider: p.key,
      name,
      label: name,
      url,
      config: {},
      status: "active",
      schedule: "manual",
      scope: [],
      extract_mode: p.ingest === "scrape" ? "assisted" : "ai",
    });
    if (error) throw error;
    setConnecting(null);
    setBrowsing(false);
    await reload();
  });

  const inboundCount = messages.filter((m) => m.direction === "inbound").length;
  const outboundCount = messages.length - inboundCount;

  return (
    <>
      <div className="head">
        <h1>Integrations</h1>
        <p>
          Every place BrandWield gets information from. Each one is a standing connection with its
          own settings: what it may write to, how often it runs, and how far it is trusted.
        </p>
      </div>

      <Notice kind="err">{create.error}</Notice>

      <div className="row between" style={{ marginBottom: 16 }}>
        <div className="small muted">
          {sources.length} connected
          {inboundCount > 0 && ` · ${inboundCount} customer messages`}
          {outboundCount > 0 && ` · ${outboundCount} of your own posts`}
        </div>
        <button className="primary" onClick={() => { setBrowsing((v) => !v); setConnecting(null); }}>
          {browsing ? "Close" : "Connect a platform"}
        </button>
      </div>

      {connecting && (
        <ConnectForm
          provider={connecting}
          defaultUrl={connecting.category === "web" ? b.website_url ?? "" : ""}
          busy={create.busy}
          onCancel={() => setConnecting(null)}
          onCreate={(name, url) => create.run(connecting, name, url)}
        />
      )}

      {browsing && !connecting && (
        <Catalogue
          providers={providers}
          connected={connected}
          onPick={(p) => setConnecting(p)}
        />
      )}

      {sources.length === 0 ? (
        <Empty title="Nothing connected yet">
          <p className="tight">
            Start with your website. It is the fastest way to fill a profile, and it costs nothing.
          </p>
          <button className="primary" onClick={() => setBrowsing(true)}>
            Connect a platform
          </button>
        </Empty>
      ) : (
        <div className="stack">
          {sources.map((s) => (
            <IntegrationCard
              key={s.id}
              source={s}
              provider={providerOf.get(s.provider ?? "") ?? null}
              facts={factsBySource.get(s.id) ?? []}
              messages={messages.filter((m) => m.source_id === s.id)}
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

      {runs.length > 0 && <RunHistory runs={runs} />}
    </>
  );
}

/* ------------------------------------------------------------- catalogue */

function Catalogue({
  providers,
  connected,
  onPick,
}: {
  providers: SourceProvider[];
  connected: Set<string | null>;
  onPick: (p: SourceProvider) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const matching = needle
    ? providers.filter(
        (p) =>
          p.label.toLowerCase().includes(needle) ||
          p.blurb.toLowerCase().includes(needle) ||
          p.category.includes(needle),
      )
    : providers;

  return (
    <div className="card" style={{ marginBottom: 22, borderColor: "var(--violet-line)" }}>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <h3 style={{ margin: 0 }}>Connect a platform</h3>
          <p className="sub" style={{ marginTop: 4 }}>
            Each one says how it actually connects. Nothing here needs an OAuth app or a password.
          </p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search platforms"
          style={{ maxWidth: 220 }}
        />
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const group = matching.filter((p) => p.category === cat);
        if (!group.length) return null;
        return (
          <div key={cat} style={{ marginTop: 18 }}>
            <div className="section-title" style={{ marginTop: 0 }}>
              {CATEGORY_LABEL[cat]}
            </div>
            <p className="small muted" style={{ margin: "0 0 10px" }}>
              {CATEGORY_BLURB[cat]}
            </p>
            <div className="provider-grid">
              {group.map((p) => (
                <button
                  key={p.key}
                  className="provider"
                  onClick={() => onPick(p)}
                  title={p.blurb}
                >
                  <span className="row between" style={{ gap: 8 }}>
                    <strong>{p.label}</strong>
                    {connected.has(p.key) && <span className="pill green">on</span>}
                  </span>
                  <span className="small muted">{p.blurb}</span>
                  <span className={`pill ${p.live ? "violet" : ""}`}>
                    {p.live ? INGEST_LABEL[p.ingest] : "Paste for now"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {matching.length === 0 && (
        <p className="small muted" style={{ marginTop: 16 }}>
          Nothing matches that. Anything with an outgoing webhook can use the contact form
          integration, whatever it is called.
        </p>
      )}
    </div>
  );
}

function ConnectForm({
  provider,
  defaultUrl,
  busy,
  onCancel,
  onCreate,
}: {
  provider: SourceProvider;
  defaultUrl: string;
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string, url: string | null) => void;
}) {
  const [name, setName] = useState(provider.label);
  const [url, setUrl] = useState(defaultUrl);
  const wantsUrl = provider.ingest === "feed" || provider.ingest === "scrape";

  return (
    <div className="card" style={{ marginBottom: 22, borderColor: "var(--violet-line)" }}>
      <div className="row" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Connect {provider.label}</h3>
        <span className={`pill ${provider.live ? "violet" : ""}`}>
          {provider.live ? INGEST_LABEL[provider.ingest] : "Paste for now"}
        </span>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>{provider.blurb}</p>
      {provider.setup && (
        <p className="small muted" style={{ marginTop: 8, maxWidth: "70ch" }}>{provider.setup}</p>
      )}

      <div className="inline-form" style={{ marginTop: 14 }}>
        <div>
          <label htmlFor="cn">Name it</label>
          <input id="cn" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {wantsUrl && (
          <div>
            <label htmlFor="cu">URL</label>
            <input
              id="cu"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={provider.url_hint ?? "example.com"}
            />
          </div>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            let u = url.trim();
            if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
            onCreate(name.trim() || provider.label, wantsUrl ? u || null : null);
          }}
        >
          <Busy busy={busy}>Connect</Busy>
        </button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>

      {provider.ingest === "webhook" && (
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Connecting mints a private URL for this integration. Whatever you point at it starts
          arriving straight away.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ one card */

function IntegrationCard({
  source,
  provider,
  facts,
  messages,
  labelOf,
  modules,
  brandId,
  defaultUrl,
  onDone,
}: {
  source: Source;
  provider: SourceProvider | null;
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
  const ingest = provider?.ingest ?? (source.kind === "web_scrape" ? "scrape" : "paste");

  const run = useAction(async (payload: Record<string, unknown>) => {
    const mode = source.extract_mode ?? "assisted";
    const said: string[] = [];

    // Rules first. Free, fast, and it never invents anything.
    if (ingest === "scrape" && mode !== "ai") {
      const h = await fn<{
        pages_read: number;
        proposed: number;
        fields_covered: number;
        still_empty_required?: string[];
        rules_fired?: Record<string, number>;
      }>("harvest", { brand_id: brandId, source_id: source.id, ...payload });
      const rules = Object.keys(h.rules_fired ?? {}).length;
      said.push(
        `Rules read ${h.pages_read} pages and captured ${h.proposed} values across ${h.fields_covered} fields from ${rules} matching rules, with no model involved.`,
      );
      if (mode === "rules" && h.still_empty_required?.length) {
        said.push(`Rules could not answer: ${h.still_empty_required.slice(0, 6).join(", ")}.`);
      }
    }

    // Then the model, for whatever is left.
    if (!(ingest === "scrape" && mode === "rules")) {
      const endpoint = source.kind === "ai_inference" ? "infer" : "collect";
      try {
        const r = await fn<Record<string, unknown>>(endpoint, {
          brand_id: brandId,
          source_id: source.id,
          ...payload,
        });
        const bits = [
          typeof r.pages_read === "number" && !said.length ? `${r.pages_read} pages read` : null,
          typeof r.proposed === "number" ? `${r.proposed} values` : null,
          typeof r.below_confidence_floor === "number" && r.below_confidence_floor
            ? `${r.below_confidence_floor} below the confidence floor`
            : null,
        ].filter(Boolean);
        said.push(said.length ? `Model pass added ${bits.join(", ")}.` : `${bits.join(", ")}.`);
      } catch (e) {
        const msg = (e as Error).message;
        if (said.length && /no_api_key/.test(msg)) {
          said.push("The model pass was skipped because there is no Anthropic key on your account.");
        } else {
          throw e;
        }
      }
    }

    await onDone();
    return said.join(" ") || "Done.";
  });

  const pull = useAction(async (url: string) => {
    const r = await fn<{
      feed_url: string; items_found: number; imported: number; already_had: number; direction: string;
    }>("feed", { brand_id: brandId, source_id: source.id, url });
    await onDone();
    return `Read ${r.items_found} items from ${r.feed_url} and imported ${r.imported} new ones${
      r.already_had ? `, skipping ${r.already_had} already held` : ""
    }.`;
  });

  const mine = useAction(async () => {
    const r = await fn<{ gaps_found: number; messages_read: number }>("mine", { brand_id: brandId });
    await onDone();
    return `Read ${r.messages_read} customer messages and found ${r.gaps_found} market gaps.`;
  });

  const actionLabel =
    ingest === "webhook" ? "Endpoint and messages"
      : ingest === "feed" ? "Fetch posts"
      : ingest === "upload" ? "Upload"
      : ingest === "paste" ? "Paste material"
      : "Capture now";

  return (
    <div className="card pad-sm">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill violet">{provider?.label ?? source.kind}</span>
            <strong>{source.name ?? source.label}</strong>
            {source.status === "paused" && <span className="pill">Paused</span>}
            {provider && !provider.live && <span className="pill">paste for now</span>}
          </div>
          <div className="sub" style={{ marginTop: 3 }}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
            ) : (
              provider?.blurb ?? ""
            )}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {ingest === "webhook"
              ? "Receives whatever the platform sends, the moment it sends it"
              : source.schedule === "manual"
                ? "Runs only when you say so"
                : `Runs ${source.schedule}`}
            {" · "}
            {source.run_count ?? 0} {(source.run_count ?? 0) === 1 ? "run" : "runs"}
            {" · last "}
            {timeAgo(source.last_run_at)}
            {ingest === "scrape" &&
              ` · ${source.extract_mode === "rules" ? "rules only" : source.extract_mode === "ai" ? "AI only" : "rules then AI"}`}
            {messages.length > 0 && ` · ${messages.length} messages`}
            {scope.length > 0 && ` · writes to ${scope.length} modules only`}
            {source.auto_confirm && " · auto confirms"}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="sm" onClick={() => setOpen(open === "settings" ? "none" : "settings")}>
            Settings
          </button>
          <button className="primary sm" onClick={() => setOpen(open === "run" ? "none" : "run")}>
            {actionLabel}
          </button>
        </div>
      </div>

      <Notice kind="err">{run.error ?? pull.error ?? mine.error}</Notice>
      <Notice kind="ok">{run.done ?? pull.done ?? mine.done}</Notice>

      {facts.length > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          <span className="small muted" style={{ marginRight: 4 }}>
            {confirmed} confirmed{pending ? `, ${pending} waiting` : ""}:
          </span>
          {[...new Set(facts.map((f) => f.field_key))].slice(0, 12).map((k) => (
            <span className="pill" key={k}>{labelOf.get(k) ?? k}</span>
          ))}
        </div>
      )}

      {open === "settings" && (
        <IntegrationSettings source={source} provider={provider} modules={modules} onDone={onDone} />
      )}

      {open === "run" && ingest === "scrape" && (
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

      {open === "run" && ingest === "feed" && (
        <FeedPanel source={source} provider={provider} pull={pull} messages={messages} />
      )}
      {open === "run" && ingest === "paste" && <PasteRun run={run} provider={provider} />}
      {open === "run" && ingest === "upload" && <InferRun run={run} />}
      {open === "run" && ingest === "webhook" && (
        <WebhookPanel
          source={source}
          provider={provider}
          messages={messages}
          mine={mine}
          onDone={onDone}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- settings */

function IntegrationSettings({
  source,
  provider,
  modules,
  onDone,
}: {
  source: Source;
  provider: SourceProvider | null;
  modules: { group_key: string; label: string; enabled: boolean }[];
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState(source.name ?? source.label);
  const [url, setUrl] = useState(source.url ?? "");
  const [schedule, setSchedule] = useState<Source["schedule"]>(source.schedule ?? "manual");
  const [mode, setMode] = useState<Source["extract_mode"]>(source.extract_mode ?? "assisted");
  const [status, setStatus] = useState<Source["status"]>(source.status ?? "active");
  const [scope, setScope] = useState<string[]>((source.scope ?? []) as string[]);
  const [floor, setFloor] = useState(String(source.min_confidence ?? 0));
  const [autoConfirm, setAutoConfirm] = useState(!!source.auto_confirm);

  const ingest = provider?.ingest ?? "paste";
  const writesFacts = ingest !== "webhook";

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
        extract_mode: mode,
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
        {(ingest === "scrape" || ingest === "feed") && (
          <div className="field">
            <label>
              URL
              {provider?.url_hint && <span className="hint">Looks like {provider.url_hint}</span>}
            </label>
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        {ingest !== "webhook" && (
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
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        )}
        {ingest === "scrape" && (
          <div className="field">
            <label>
              How it extracts
              <span className="hint">
                Rules read schema.org, meta tags and link protocols. They cost nothing, need no API
                key, and cannot invent a value. The model is only worth paying for on what rules
                cannot answer.
              </span>
            </label>
            <select value={mode} onChange={(e) => setMode(e.target.value as Source["extract_mode"])}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>
            Status
            {ingest === "webhook" && (
              <span className="hint">Paused stops the endpoint accepting anything new.</span>
            )}
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Source["status"])}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>

      {writesFacts && (
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
                <button className="ghost sm" onClick={() => setScope([])}>Clear</button>
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
              <select
                value={autoConfirm ? "auto" : "review"}
                onChange={(e) => setAutoConfirm(e.target.value === "auto")}
              >
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
        Disconnecting removes the integration and kills its endpoint. Values it already captured stay
        in the profile, with their history intact.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- run panels */

type Runner = ReturnType<typeof useAction<[Record<string, unknown>]>>;

function PasteRun({ run, provider }: { run: Runner; provider: SourceProvider | null }) {
  const [text, setText] = useState("");
  return (
    <div style={{ marginTop: 14 }}>
      {provider?.setup && <p className="small muted" style={{ marginTop: 0 }}>{provider.setup}</p>}
      <div className="field">
        <label>Paste the material</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A profile page, a set of posts, a brochure, or just what the business does."
        />
      </div>
      <button className="primary" disabled={run.busy} onClick={() => run.run({ pasted_text: text, kind: "paste" })}>
        <Busy busy={run.busy}>Capture now</Busy>
      </button>
    </div>
  );
}

function FeedPanel({
  source,
  provider,
  pull,
  messages,
}: {
  source: Source;
  provider: SourceProvider | null;
  pull: ReturnType<typeof useAction<[string]>>;
  messages: Message[];
}) {
  const [url, setUrl] = useState(source.url ?? "");
  return (
    <div style={{ marginTop: 14 }}>
      {provider?.setup && <p className="small muted" style={{ marginTop: 0 }}>{provider.setup}</p>}
      <div className="inline-form">
        <div>
          <label>Address</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={provider?.url_hint ?? "example.com/blog"}
          />
        </div>
        <button className="primary" disabled={pull.busy} onClick={() => pull.run(url)}>
          <Busy busy={pull.busy}>Fetch posts</Busy>
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Posts land as your own writing, not as customer messages, so they feed voice inference rather
        than the market gap loop.
      </p>
      {messages.length > 0 && <MessageTable messages={messages} />}
    </div>
  );
}

function WebhookPanel({
  source,
  provider,
  messages,
  mine,
  onDone,
}: {
  source: Source;
  provider: SourceProvider | null;
  messages: Message[];
  mine: { run: () => void; busy: boolean };
  onDone: () => Promise<void>;
}) {
  const [token, setToken] = useState(source.ingest_token ?? "");
  const [shown, setShown] = useState(false);
  const [bulk, setBulk] = useState("");

  const rotate = useAction(async () => {
    const { data, error } = await supabase.rpc("rotate_ingest_token", { p_source: source.id });
    if (error) throw error;
    setToken(String(data));
    setShown(true);
    await onDone();
    return "New URL minted. The old one stops working immediately, so update the platform.";
  });

  const importBulk = useAction(async () => {
    const blocks = bulk.split(/\n\s*\n/).map((t) => t.trim()).filter((t) => t.length > 3);
    if (!blocks.length) throw new Error("Paste at least one message.");
    const rows = blocks.map((block) => {
      const m = block.match(/^\s*(?:from:\s*)?([^\n]{1,80}?)\s*\n([\s\S]+)$/i);
      const looksLikeSender = m && m[1].length < 60 && !/[.!?]$/.test(m[1]);
      return {
        brand_id: source.brand_id,
        source_id: source.id,
        provider: source.provider,
        channel: source.provider ?? "manual",
        direction: "inbound",
        sender: looksLikeSender ? m![1].replace(/^from:\s*/i, "").trim() : null,
        body: looksLikeSender ? m![2].trim() : block,
      };
    });
    const { error } = await supabase.from("messages").insert(rows);
    if (error) throw error;
    setBulk("");
    await onDone();
    return `Imported ${rows.length} messages by hand.`;
  });

  const url = token ? ingestUrl(token) : "";

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
      <Notice kind="err">{rotate.error ?? importBulk.error}</Notice>
      <Notice kind="ok">{rotate.done ?? importBulk.done}</Notice>

      <div className="field">
        <label>
          Ingest URL
          <span className="hint">
            Anything that can send an HTTP POST can feed this. Treat it as a password: whoever holds
            it can write messages into this brand.
          </span>
        </label>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <input
            type="text"
            readOnly
            value={shown ? url : url.replace(/t=.*/, "t=" + "•".repeat(12))}
            onFocus={(e) => e.currentTarget.select()}
            style={{ fontFamily: "var(--mono)", fontSize: 12 }}
          />
          <button className="sm" onClick={() => setShown((v) => !v)}>{shown ? "Hide" : "Reveal"}</button>
          <CopyButton text={url} label="Copy URL" />
          <button className="ghost sm" onClick={() => rotate.run()} disabled={rotate.busy}>
            <Busy busy={rotate.busy}>New URL</Busy>
          </button>
        </div>
      </div>

      {provider?.setup && (
        <p className="small muted" style={{ maxWidth: "72ch" }}>
          <strong>{provider.label}: </strong>
          {provider.setup}
        </p>
      )}

      <details className="history" style={{ marginTop: 6 }}>
        <summary>What a payload should look like</summary>
        <pre className="code">{`POST ${url || "<your ingest URL>"}
Content-Type: application/json

{ "from": "sarah@example.com",
  "subject": "Weekend callouts",
  "body": "Do you do same day callouts on weekends?" }`}</pre>
        <p className="small muted">
          Field names are read loosely: body, text, message and content all work for the message,
          and from, sender, email or name for who sent it. Form encoded posts work too, so a Twilio
          number can point straight here. A Slack event envelope is unwrapped, its handshake is
          answered, and any id in the payload is used to ignore a repeat delivery. Nothing that
          looks like a token or a password is kept.
        </p>
      </details>

      <div className="field" style={{ marginTop: 12 }}>
        <label>
          Or paste messages by hand
          <span className="hint">One per block, blank line between. Optional first line is the sender.</span>
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

      {messages.length > 0 && <MessageTable messages={messages} />}
    </div>
  );
}

function MessageTable({ messages }: { messages: Message[] }) {
  return (
    <div className="scroll-x" style={{ marginTop: 14 }}>
      <table className="table">
        <thead>
          <tr>
            <th>From</th>
            <th>Way</th>
            <th>Message</th>
            <th className="right">When</th>
          </tr>
        </thead>
        <tbody>
          {messages.slice(0, 50).map((m) => (
            <tr key={m.id}>
              <td className="small">{m.sender ?? <span className="muted">unknown</span>}</td>
              <td>
                <span className={`pill ${m.direction === "outbound" ? "" : "violet"}`}>
                  {m.direction === "outbound" ? "you posted" : "they asked"}
                </span>
              </td>
              <td>
                {m.subject && <strong>{m.subject}. </strong>}
                {m.body.slice(0, 400)}
                {m.permalink && (
                  <>
                    {" "}
                    <a href={m.permalink} target="_blank" rel="noreferrer" className="small">
                      source
                    </a>
                  </>
                )}
              </td>
              <td className="right small muted">{timeAgo(m.received_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        {logo && (
          <img
            src={logo}
            alt=""
            style={{ height: 34, marginTop: 8, borderRadius: 6, border: "1px solid var(--line)" }}
          />
        )}
      </div>
      <div className="field">
        <label>
          Past posts
          <span className="hint">
            Optional. Anything a feed integration already collected is read automatically, so leave
            this empty if a feed is connected.
          </span>
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

/* --------------------------------------------------------- run history */

function RunHistory({ runs }: { runs: { id: string; kind: string; status: string; detail: unknown; error: string | null; started_at: string }[] }) {
  return (
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
              const d = (r.detail ?? {}) as Record<string, unknown>;
              const bits = [
                Array.isArray(d.pages) ? `${(d.pages as string[]).length} pages read` : null,
                typeof d.items_found === "number" ? `${d.items_found} feed items` : null,
                typeof d.imported === "number" ? `${d.imported} imported` : null,
                typeof d.proposed === "number" ? `${d.proposed} values` : null,
                typeof d.auto_confirmed === "number" && d.auto_confirmed ? `${d.auto_confirmed} auto confirmed` : null,
                typeof d.below_confidence_floor === "number" && d.below_confidence_floor
                  ? `${d.below_confidence_floor} below floor` : null,
                typeof d.fields_covered === "number" ? `${d.fields_covered} fields` : null,
                d.rules_fired && typeof d.rules_fired === "object"
                  ? `${Object.keys(d.rules_fired as object).length} rules fired` : null,
                typeof d.collected_posts === "number" && d.collected_posts
                  ? `${d.collected_posts} collected posts read` : null,
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
  );
}
