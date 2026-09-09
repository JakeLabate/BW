import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { completeness, historyFor, openGaps, proposedFacts, useBrand } from "../lib/store";
import {
  SOURCE_LABEL,
  type Fact,
  type FactHistory,
  type FieldDef,
  type Gap,
  type ModuleStatus,
} from "../lib/types";
import { Busy, Empty, Notice, timeAgo, useAction } from "../lib/ui";

type Filter = "attention" | "all" | "filled" | "empty";

export default function MyBrand() {
  const { brand, defs, modules, facts, history, industries, gaps, reload } = useBrand();
  const b = brand!;
  const [filter, setFilter] = useState<Filter>("attention");

  const byField = useMemo(() => {
    const map = new Map<string, Fact[]>();
    for (const f of facts) {
      if (f.status === "rejected") continue;
      if (!map.has(f.field_key)) map.set(f.field_key, []);
      map.get(f.field_key)!.push(f);
    }
    return map;
  }, [facts]);

  const fieldsByGroup = useMemo(() => {
    const map = new Map<string, FieldDef[]>();
    for (const d of defs) {
      if (!map.has(d.group_key)) map.set(d.group_key, []);
      map.get(d.group_key)!.push(d);
    }
    return map;
  }, [defs]);

  const setStatus = useAction(async (id: string, status: "confirmed" | "rejected") => {
    const { error } = await supabase.from("brand_facts").update({ status }).eq("id", id);
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: b.id });
    await reload();
  });

  const confirmAll = useAction(async () => {
    const ids = proposedFacts(facts).map((p) => p.id);
    if (!ids.length) return;
    const { error } = await supabase.from("brand_facts").update({ status: "confirmed" }).in("id", ids);
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: b.id });
    await reload();
  });

  // Nothing to show until the brand is on an industry preset
  if (!b.industry_key) return <PickIndustry />;

  const c = completeness(modules);
  const proposed = proposedFacts(facts);
  const marketGaps = openGaps(gaps, "market");
  const enabled = modules.filter((m) => m.enabled);
  const confirmedKeys = new Set(
    facts.filter((f) => f.status === "confirmed").map((f) => f.field_key),
  );
  const proposedKeys = new Set(proposed.map((f) => f.field_key));
  const needsAttention = (d: FieldDef) =>
    proposedKeys.has(d.key) || (d.required && !confirmedKeys.has(d.key));
  const attentionCount = defs.filter(
    (d) => enabled.some((m) => m.group_key === d.group_key) && needsAttention(d),
  ).length;
  const available = modules.filter((m) => !m.enabled);
  const industry = industries.find((i) => i.key === b.industry_key);

  return (
    <>
      <div className="head">
        <h1>My Brand</h1>
        <p>
          Everything BrandWield knows about {b.name}, and where each piece came from. A value only
          counts once you confirm it, and only confirmed values are allowed into content.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="row between">
          <div>
            <strong>
              {c.requiredFilled} of {c.requiredTotal} required fields confirmed
            </strong>
            <div className="sub">
              {c.fieldsFilled} of {c.fieldsTotal} fields filled across {enabled.length} modules
              {industry ? ` · ${industry.label} preset` : ""}
            </div>
          </div>
          <div className="row">
            <button
              className={filter === "attention" ? "sm ok" : "sm"}
              onClick={() => setFilter("attention")}
            >
              Needs attention
              {attentionCount > 0 && <span className="count hot" style={{ marginLeft: 6 }}>{attentionCount}</span>}
            </button>
            {(["all", "filled", "empty"] as const).map((f) => (
              <button key={f} className={filter === f ? "sm ok" : "sm"} onClick={() => setFilter(f)}>
                {f === "all" ? "Everything" : f === "filled" ? "Filled" : "Empty"}
              </button>
            ))}
          </div>
        </div>
        <div className="meter" style={{ marginTop: 12 }}>
          <i style={{ width: `${c.pct}%` }} />
        </div>
      </div>

      <Notice kind="err">{setStatus.error ?? confirmAll.error}</Notice>

      {proposed.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: "var(--amber-line)", background: "var(--amber-soft)" }}>
          <div className="row between">
            <div>
              <h3>{proposed.length} proposed values</h3>
              <div className="sub">Collected but not yet true. Confirm what is right, reject what is not.</div>
            </div>
            <button onClick={() => confirmAll.run()} disabled={confirmAll.busy}>
              <Busy busy={confirmAll.busy}>Confirm all</Busy>
            </button>
          </div>
        </div>
      )}

      {marketGaps.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="module-head">
            <div>
              <h2>Demand you are not serving</h2>
              <p className="sub tight">
                Read out of the customer inbox. Approving one adds a real offer to this brand, which
                the Generate tab can then announce.
              </p>
            </div>
          </div>
          <div className="stack">
            {marketGaps.map((g) => (
              <MarketGap key={g.id} gap={g} brandId={b.id} onDone={reload} />
            ))}
          </div>
        </section>
      )}

      {filter === "attention" && attentionCount === 0 && marketGaps.length === 0 && (
        <Empty title="Nothing needs you right now">
          <p className="tight">
            Every required field has a confirmed value and no collected value is waiting for review.
          </p>
        </Empty>
      )}

      {enabled.map((m) => {
        const fields = (fieldsByGroup.get(m.group_key) ?? []).filter((d) => {
          const has = (byField.get(d.key) ?? []).some((f) => f.status === "confirmed");
          if (filter === "attention") return needsAttention(d);
          if (filter === "filled") return has;
          if (filter === "empty") return !has;
          return true;
        });
        if (!fields.length) return null;
        return (
          <section key={m.group_key} style={{ marginBottom: 26 }}>
            <div className="module-head">
              <div>
                <h2>{m.label}</h2>
                {m.blurb && <p className="sub tight">{m.blurb}</p>}
              </div>
              <div className="module-meter">
                <span className="small muted">
                  {m.fields_filled}/{m.fields_total}
                </span>
                <div className="meter" style={{ width: 90 }}>
                  <i style={{ width: `${m.fields_total ? (m.fields_filled / m.fields_total) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
            <div className="stack">
              {fields.map((d) => (
                <FieldCard
                  key={d.key}
                  def={d}
                  facts={byField.get(d.key) ?? []}
                  history={historyFor(history, d.key)}
                  brandId={b.id}
                  onChange={reload}
                  onStatus={(id, s) => setStatus.run(id, s)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {available.length > 0 && <Grow brandId={b.id} modules={available} onChange={reload} />}
    </>
  );
}

/* ------------------------------------------------------------------ field */

function FieldCard({
  def,
  facts,
  history,
  brandId,
  onChange,
  onStatus,
}: {
  def: FieldDef;
  facts: Fact[];
  history: FactHistory[];
  brandId: string;
  onChange: () => Promise<void>;
  onStatus: (id: string, s: "confirmed" | "rejected") => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const confirmed = facts.filter((f) => f.status === "confirmed");
  const proposals = facts.filter((f) => f.status === "proposed");

  const add = useAction(async () => {
    if (!value.trim()) throw new Error("Nothing to add.");
    const { error } = await supabase.from("brand_facts").insert({
      brand_id: brandId,
      field_key: def.key,
      value: value.trim(),
      status: "confirmed",
      confidence: 1,
      source_kind: "owner_input",
      evidence: {},
    });
    if (error) throw error;
    setValue("");
    setAdding(false);
    await supabase.rpc("refresh_profile_gaps", { p_brand: brandId });
    await onChange();
  });

  const saveEdit = useAction(async (id: string) => {
    if (!draft.trim()) throw new Error("A value cannot be empty.");
    const { error } = await supabase.from("brand_facts").update({ value: draft.trim() }).eq("id", id);
    if (error) throw error;
    setEditing(null);
    await onChange();
  });

  const remove = useAction(async (id: string) => {
    const { error } = await supabase.from("brand_facts").delete().eq("id", id);
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: brandId });
    await onChange();
  });

  return (
    <div className="card pad-sm">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <strong>{def.label}</strong>
            {def.required && <span className="pill">Required</span>}
            {def.multi && <span className="pill">Multiple</span>}
            {confirmed.length === 0 && <span className="pill amber">Empty</span>}
          </div>
          {def.help && <div className="sub" style={{ marginTop: 2 }}>{def.help}</div>}
        </div>
        {(def.multi || confirmed.length === 0) && !adding && (
          <button className="ghost sm" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </div>

      <Notice kind="err">{add.error ?? remove.error ?? saveEdit.error}</Notice>

      {adding && (
        <div className="inline-form" style={{ marginTop: 10 }}>
          <input
            type="text"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add.run()}
            placeholder={`Add ${def.label.toLowerCase()}`}
          />
          <button className="primary sm" onClick={() => add.run()} disabled={add.busy}>
            <Busy busy={add.busy}>Save</Busy>
          </button>
          <button className="ghost sm" onClick={() => { setAdding(false); setValue(""); }}>
            Cancel
          </button>
        </div>
      )}

      {(confirmed.length > 0 || proposals.length > 0) && (
        <div style={{ marginTop: 10 }}>
          {confirmed.map((f) =>
            editing === f.id ? (
              <div className="inline-form" key={f.id} style={{ marginTop: 8 }}>
                <input type="text" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button className="primary sm" onClick={() => saveEdit.run(f.id)} disabled={saveEdit.busy}>
                  <Busy busy={saveEdit.busy}>Save</Busy>
                </button>
                <button className="ghost sm" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="fact" key={f.id}>
                <div className="val">
                  <div className="v">{f.value}</div>
                  <div className="q">
                    {SOURCE_LABEL[f.source_kind]}
                    {f.evidence?.quote ? ` — "${f.evidence.quote}"` : ""}
                  </div>
                </div>
                <div className="acts">
                  <button className="ghost sm" onClick={() => { setEditing(f.id); setDraft(f.value); }}>
                    Edit
                  </button>
                  <button className="ghost sm danger" onClick={() => remove.run(f.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ),
          )}

          {proposals.map((f) => (
            <div className="fact proposed" key={f.id}>
              <div className="val">
                <div className="v">{f.value}</div>
                <div className="q">
                  {SOURCE_LABEL[f.source_kind]}
                  {f.confidence != null ? ` · confidence ${f.confidence}` : ""}
                  {f.evidence?.quote ? ` — "${f.evidence.quote}"` : ""}
                </div>
              </div>
              <div className="acts">
                <button className="sm ok" onClick={() => onStatus(f.id, "confirmed")}>
                  Confirm
                </button>
                <button className="ghost sm danger" onClick={() => onStatus(f.id, "rejected")}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="history">
          <summary>
            {history.length} {history.length === 1 ? "change" : "changes"}
            <span className="muted"> · last {timeAgo(history[0].at)}</span>
          </summary>
          <ol className="trail">
            {history.map((h) => (
              <li key={h.id}>
                <span className={`pill ${actionTone(h.action)}`}>{h.action}</span>
                <span className="trail-body">
                  {h.action === "edited" ? (
                    <>
                      <s className="muted">{h.from_value}</s> → <strong>{h.to_value}</strong>
                    </>
                  ) : h.action === "removed" ? (
                    <s className="muted">{h.from_value}</s>
                  ) : h.action === "confirmed" || h.action === "rejected" ? (
                    <span className="muted">
                      {h.from_value} → {h.to_value}
                    </span>
                  ) : (
                    <strong>{h.to_value}</strong>
                  )}
                </span>
                <span className="trail-meta">
                  {h.source_kind ? SOURCE_LABEL[h.source_kind] : "unknown source"} · {timeAgo(h.at)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function actionTone(a: string) {
  if (a === "confirmed" || a === "added") return "green";
  if (a === "rejected" || a === "removed") return "red";
  if (a === "proposed") return "amber";
  return "violet";
}

/* ------------------------------------------------------------------- grow */

function Grow({
  brandId,
  modules,
  onChange,
}: {
  brandId: string;
  modules: ModuleStatus[];
  onChange: () => Promise<void>;
}) {
  const ready = modules.filter((m) => m.ready);
  const later = modules.filter((m) => !m.ready);

  const enable = useAction(async (key: string) => {
    const { error } = await supabase.rpc("set_module", { p_brand: brandId, p_group: key, p_on: true });
    if (error) throw error;
    await onChange();
  });

  return (
    <section style={{ marginTop: 10 }}>
      <div className="module-head">
        <div>
          <h2>Grow this profile</h2>
          <p className="sub tight">
            More structure, only when it earns its place. Modules appear here once the basics are
            filling out, or when something already collected belongs in them.
          </p>
        </div>
      </div>

      <Notice kind="err">{enable.error}</Notice>

      {ready.length > 0 && (
        <div className="grid two">
          {ready.map((m) => (
            <div className="card pad-sm grow-card" key={m.group_key}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div>
                  <strong>{m.label}</strong>
                  {m.blurb && <div className="sub">{m.blurb}</div>}
                </div>
                <button className="primary sm" onClick={() => enable.run(m.group_key)} disabled={enable.busy}>
                  <Busy busy={enable.busy}>Add</Busy>
                </button>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                {m.fields_total} fields
                {m.required_total > 0 ? `, ${m.required_total} of them required` : ""}
                {m.proposed_facts > 0 && (
                  <>
                    {" · "}
                    <strong style={{ color: "var(--amber)" }}>
                      {m.proposed_facts} already collected and waiting
                    </strong>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {later.length > 0 && (
        <div className="card pad-sm" style={{ marginTop: 14 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Available later, once the modules above are further along:
          </div>
          <div className="row" style={{ gap: 6 }}>
            {later.map((m) => (
              <span className="pill" key={m.group_key} title={m.blurb ?? ""}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- industry */

function PickIndustry() {
  const { brand, industries, reload } = useBrand();
  const b = brand!;
  const [key, setKey] = useState("");

  const save = useAction(async () => {
    if (!key) throw new Error("Pick one first.");
    const { error } = await supabase.from("brands").update({ industry_key: key }).eq("id", b.id);
    if (error) throw error;
    const { data: mods } = await supabase
      .from("industry_modules")
      .select("group_key")
      .eq("industry_key", key)
      .eq("tier", 0);
    if (mods?.length) {
      await supabase
        .from("brand_modules")
        .insert(mods.map((m) => ({ brand_id: b.id, group_key: m.group_key })));
    }
    await supabase.rpc("refresh_profile_gaps", { p_brand: b.id });
    await reload();
  });

  return (
    <>
      <div className="head">
        <h1>What kind of business is this?</h1>
        <p>
          It decides which fields the profile starts with. A real estate agent does not need a fleet,
          and a dealership does not need listings. You can change it later, and nothing already
          recorded is thrown away.
        </p>
      </div>
      <Notice kind="err">{save.error}</Notice>
      <div className="grid two">
        {industries.map((i) => (
          <button
            key={i.key}
            className={`pick ${key === i.key ? "on" : ""}`}
            onClick={() => setKey(i.key)}
          >
            <strong>{i.label}</strong>
            <span className="sub">{i.blurb}</span>
          </button>
        ))}
      </div>
      <button className="primary" style={{ marginTop: 18 }} onClick={() => save.run()} disabled={save.busy || !key}>
        <Busy busy={save.busy}>Use this preset</Busy>
      </button>
    </>
  );
}

/* -------------------------------------------------------- market gaps */

function MarketGap({ gap, brandId, onDone }: { gap: Gap; brandId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(gap.title);
  const [price, setPrice] = useState("");

  const approve = useAction(async () => {
    if (!name.trim()) throw new Error("Name the offer.");
    const { error } = await supabase.from("offers").insert({
      brand_id: brandId,
      gap_id: gap.id,
      name: name.trim(),
      description: gap.suggestion ?? gap.detail,
      price: price.trim() || null,
      status: "approved",
    });
    if (error) throw error;
    await supabase
      .from("gaps")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", gap.id);
    await onDone();
  });

  const reject = useAction(async () => {
    const { error } = await supabase.from("gaps").update({ status: "dismissed" }).eq("id", gap.id);
    if (error) throw error;
    await onDone();
  });

  return (
    <div className="card" style={{ borderColor: "var(--amber-line)" }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="pill amber">Market gap</span>
        <span className="pill">{gap.demand_count} asks</span>
      </div>
      <h3 style={{ marginTop: 6 }}>{gap.title}</h3>
      {gap.detail && <p className="sub" style={{ marginTop: 4 }}>{gap.detail}</p>}

      {gap.suggestion && (
        <div className="notice info" style={{ marginTop: 10 }}>
          <strong>Suggestion.</strong> {gap.suggestion}
        </div>
      )}

      {gap.evidence?.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            {gap.evidence.length} messages behind this
          </summary>
          <div style={{ marginTop: 8 }}>
            {gap.evidence.map((e, i) => (
              <div className="fact" key={i}>
                <div className="val">
                  <div className="q" style={{ fontStyle: "italic" }}>"{e.quote}"</div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <Notice kind="err">{approve.error ?? reject.error}</Notice>

      {open ? (
        <div className="inline-form" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor={`n-${gap.id}`}>Offer name</label>
            <input id={`n-${gap.id}`} type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: "0 1 160px" }}>
            <label htmlFor={`p-${gap.id}`}>Price</label>
            <input id={`p-${gap.id}`} type="text" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="From $120" />
          </div>
          <button className="primary" onClick={() => approve.run()} disabled={approve.busy}>
            <Busy busy={approve.busy}>Create the offer</Busy>
          </button>
        </div>
      ) : (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => setOpen(true)}>
            Approve and make it an offer
          </button>
          <button className="ghost danger" onClick={() => reject.run()} disabled={reject.busy}>
            Not for us
          </button>
        </div>
      )}
    </div>
  );
}
