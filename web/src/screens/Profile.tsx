import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { completeness, proposedFacts, useBrand } from "../lib/store";
import { SOURCE_LABEL, type Fact, type FieldDef } from "../lib/types";
import { Busy, Empty, Notice, useAction } from "../lib/ui";

export default function Profile() {
  const { brand, defs, facts, reload } = useBrand();
  const b = brand!;
  const c = completeness(defs, facts);
  const proposed = proposedFacts(facts);
  const [filter, setFilter] = useState<"all" | "filled" | "empty">("all");

  const categories = useMemo(() => {
    const map = new Map<string, FieldDef[]>();
    for (const d of defs) {
      if (!map.has(d.category)) map.set(d.category, []);
      map.get(d.category)!.push(d);
    }
    return [...map.entries()];
  }, [defs]);

  const byField = useMemo(() => {
    const map = new Map<string, Fact[]>();
    for (const f of facts) {
      if (f.status === "rejected") continue;
      if (!map.has(f.field_key)) map.set(f.field_key, []);
      map.get(f.field_key)!.push(f);
    }
    return map;
  }, [facts]);

  const setStatus = useAction(async (id: string, status: "confirmed" | "rejected") => {
    const { error } = await supabase.from("brand_facts").update({ status }).eq("id", id);
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: b.id });
    await reload();
  });

  const confirmAll = useAction(async () => {
    const ids = proposed.map((p) => p.id);
    if (!ids.length) return;
    const { error } = await supabase.from("brand_facts").update({ status: "confirmed" }).in("id", ids);
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: b.id });
    await reload();
  });

  return (
    <>
      <div className="head">
        <h1>Brand profile</h1>
        <p>
          One structured record. A fact only counts once you confirm it, and only confirmed facts are
          allowed into generated content.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="row between">
          <div>
            <strong>
              {c.requiredFilled} of {c.requiredTotal} required fields confirmed
            </strong>
            <div className="sub">
              {c.fieldsFilled} of {c.fieldsTotal} fields overall have something behind them.
            </div>
          </div>
          <div className="row">
            <button className={filter === "all" ? "sm ok" : "sm"} onClick={() => setFilter("all")}>
              All
            </button>
            <button className={filter === "filled" ? "sm ok" : "sm"} onClick={() => setFilter("filled")}>
              Filled
            </button>
            <button className={filter === "empty" ? "sm ok" : "sm"} onClick={() => setFilter("empty")}>
              Empty
            </button>
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
              <h3>{proposed.length} proposed facts</h3>
              <div className="sub">
                Collected but not yet true. Confirm what is right, reject what is not.
              </div>
            </div>
            <button onClick={() => confirmAll.run()} disabled={confirmAll.busy}>
              <Busy busy={confirmAll.busy}>Confirm all</Busy>
            </button>
          </div>
        </div>
      )}

      {categories.map(([category, fields]) => {
        const visible = fields.filter((d) => {
          const has = (byField.get(d.key) ?? []).some((f) => f.status === "confirmed");
          return filter === "all" || (filter === "filled" ? has : !has);
        });
        if (!visible.length) return null;
        return (
          <div key={category}>
            <div className="section-title">{category}</div>
            <div className="stack">
              {visible.map((d) => (
                <FieldCard
                  key={d.key}
                  def={d}
                  facts={byField.get(d.key) ?? []}
                  brandId={b.id}
                  onChange={reload}
                  onStatus={(id, s) => setStatus.run(id, s)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {categories.length === 0 && <Empty title="Loading the field list" />}
    </>
  );
}

function FieldCard({
  def,
  facts,
  brandId,
  onChange,
  onStatus,
}: {
  def: FieldDef;
  facts: Fact[];
  brandId: string;
  onChange: () => Promise<void>;
  onStatus: (id: string, s: "confirmed" | "rejected") => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
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

      <Notice kind="err">{add.error ?? remove.error}</Notice>

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
          {confirmed.map((f) => (
            <div className="fact" key={f.id}>
              <div className="val">
                <div className="v">{f.value}</div>
                <div className="q">
                  {SOURCE_LABEL[f.source_kind]}
                  {f.evidence?.quote ? ` — "${f.evidence.quote}"` : ""}
                </div>
              </div>
              <div className="acts">
                <button className="ghost sm danger" onClick={() => remove.run(f.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
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
    </div>
  );
}
