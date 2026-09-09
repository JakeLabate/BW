import { useState } from "react";
import { fn, supabase } from "../lib/supabase";
import { go, openGaps, useBrand } from "../lib/store";
import type { Gap } from "../lib/types";
import { Busy, Empty, Notice, useAction } from "../lib/ui";

export default function Gaps() {
  const { brand, gaps, defs, offers, messages, reload } = useBrand();
  const b = brand!;
  const profile = openGaps(gaps, "profile");
  const market = openGaps(gaps, "market");

  const refresh = useAction(async () => {
    const { error } = await supabase.rpc("refresh_profile_gaps", { p_brand: b.id });
    if (error) throw error;
    await reload();
  });

  const mine = useAction(async () => {
    const r = await fn<{ gaps_found: number; messages_read: number }>("mine", { brand_id: b.id });
    await reload();
    return `Read ${r.messages_read} messages and found ${r.gaps_found} gaps.`;
  });

  return (
    <>
      <div className="head">
        <h1>Gaps</h1>
        <p>
          Two loops feed back here. A profile gap says the record is missing something. A market gap
          says customers keep asking for something the business does not offer.
        </p>
      </div>

      <Notice kind="err">{refresh.error ?? mine.error}</Notice>
      <Notice kind="ok">{mine.done}</Notice>

      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Profile gaps ({profile.length})
        </div>
        <button className="sm" onClick={() => refresh.run()} disabled={refresh.busy}>
          <Busy busy={refresh.busy}>Recheck</Busy>
        </button>
      </div>

      {profile.length === 0 ? (
        <Empty title="The record has everything it needs">
          <p className="tight">Every required field has a confirmed value behind it.</p>
        </Empty>
      ) : (
        <div className="stack">
          {profile.map((g) => (
            <ProfileGap key={g.id} gap={g} brandId={b.id} label={defs.find((d) => d.key === g.field_key)?.label ?? g.title} onDone={reload} />
          ))}
        </div>
      )}

      <div className="row between" style={{ marginTop: 30, marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Market gaps ({market.length})
        </div>
        <button className="sm" onClick={() => mine.run()} disabled={mine.busy || messages.length === 0}>
          <Busy busy={mine.busy}>Read the inbox</Busy>
        </button>
      </div>

      {messages.length === 0 ? (
        <Empty title="No customer messages yet">
          <p className="tight">
            Market gaps come out of the inbox.{" "}
            <a href={`#/b/${b.id}/inbox`}>Import some messages</a> and run this again.
          </p>
        </Empty>
      ) : market.length === 0 ? (
        <Empty title="No market gap found">
          <p className="tight">
            The inbox does not show anything customers keep asking for that the business does not
            already sell. That is a real answer, not a failure.
          </p>
        </Empty>
      ) : (
        <div className="stack">
          {market.map((g) => (
            <MarketGap key={g.id} gap={g} brandId={b.id} onDone={reload} />
          ))}
        </div>
      )}

      {offers.length > 0 && (
        <>
          <div className="section-title">Offers on the board</div>
          <div className="card scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Offer</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th className="right">Announced</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.name}</strong>
                      {o.description && <div className="small muted">{o.description}</div>}
                    </td>
                    <td className="small">{o.price ?? "-"}</td>
                    <td>
                      <span className={`pill ${o.status === "approved" || o.status === "live" ? "green" : o.status === "rejected" ? "red" : "amber"}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="right">
                      {o.announced ? (
                        <span className="pill green">Yes</span>
                      ) : (
                        <button className="sm" onClick={() => go(`/b/${b.id}/generate?offer=${o.id}`)}>
                          Announce it
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function ProfileGap({ gap, brandId, label, onDone }: { gap: Gap; brandId: string; label: string; onDone: () => Promise<void> }) {
  const [value, setValue] = useState("");

  const fill = useAction(async () => {
    if (!value.trim()) throw new Error("Type the answer first.");
    const { error } = await supabase.from("brand_facts").insert({
      brand_id: brandId,
      field_key: gap.field_key,
      value: value.trim(),
      status: "confirmed",
      confidence: 1,
      source_kind: "owner_input",
      evidence: {},
    });
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: brandId });
    await onDone();
  });

  const dismiss = useAction(async () => {
    const { error } = await supabase.from("gaps").update({ status: "dismissed" }).eq("id", gap.id);
    if (error) throw error;
    await onDone();
  });

  return (
    <div className="card pad-sm" style={{ borderColor: "var(--amber-line)" }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill amber">Profile gap</span>
            <strong>{label}</strong>
          </div>
          {gap.detail && <div className="sub" style={{ marginTop: 4 }}>{gap.detail}</div>}
        </div>
        <button className="ghost sm" onClick={() => dismiss.run()} disabled={dismiss.busy}>
          Not relevant
        </button>
      </div>
      <Notice kind="err">{fill.error ?? dismiss.error}</Notice>
      <div className="inline-form" style={{ marginTop: 10 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fill.run()}
          placeholder={`Answer: ${label.toLowerCase()}`}
        />
        <button className="primary sm" onClick={() => fill.run()} disabled={fill.busy}>
          <Busy busy={fill.busy}>Add it</Busy>
        </button>
      </div>
    </div>
  );
}

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
    await supabase.from("gaps").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", gap.id);
    await onDone();
  });

  const reject = useAction(async () => {
    const { error } = await supabase.from("gaps").update({ status: "dismissed" }).eq("id", gap.id);
    if (error) throw error;
    await onDone();
  });

  return (
    <div className="card" style={{ borderColor: "var(--amber-line)" }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill amber">Market gap</span>
            <span className="pill">{gap.demand_count} asks</span>
          </div>
          <h3 style={{ marginTop: 6 }}>{gap.title}</h3>
          {gap.detail && <p className="sub" style={{ marginTop: 4 }}>{gap.detail}</p>}
        </div>
      </div>

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
        <div style={{ marginTop: 12 }}>
          <div className="inline-form">
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
          <p className="sub" style={{ marginTop: 8 }}>
            Approving adds it to the brand record as a real offer. From there you can turn it into an
            announcement on the Generate tab.
          </p>
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
