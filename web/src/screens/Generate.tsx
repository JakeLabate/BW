import { useState } from "react";
import { fn } from "../lib/supabase";
import { completeness, confirmedFacts, go, useBrand } from "../lib/store";
import { PLATFORMS, type Platform } from "../lib/types";
import { Busy, Notice, useAction } from "../lib/ui";

export default function Generate() {
  const { brand, modules, facts, offers, content, reload } = useBrand();
  const b = brand!;
  const c = completeness(modules);
  const confirmed = confirmedFacts(facts);

  const preselected = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("offer");
  const [offerId, setOfferId] = useState(preselected ?? "");
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [count, setCount] = useState(5);
  const [brief, setBrief] = useState("");
  const [campaign, setCampaign] = useState("");

  const announceable = offers.filter((o) => o.status === "approved" || o.status === "live");

  const run = useAction(async () => {
    const r = await fn<{ drafted: number }>("generate", {
      brand_id: b.id,
      platform,
      count,
      offer_id: offerId || undefined,
      campaign_name: campaign.trim() || undefined,
      brief: brief.trim() || undefined,
    });
    await reload();
    go(`/b/${b.id}/queue`);
    return `Wrote ${r.drafted} drafts.`;
  });

  return (
    <>
      <div className="head">
        <h1>Generate</h1>
        <p>
          Posts are written from the {confirmed.length} confirmed facts in the brand profile and
          nothing else. If a claim is not in the record it does not get written.
        </p>
      </div>

      {confirmed.length === 0 && (
        <Notice kind="warn">
          Nothing is confirmed yet, so generation would be inventing.{" "}
          <a href={`#/b/${b.id}/brand`}>Confirm some facts first</a>.
        </Notice>
      )}

      {c.requiredFilled < c.requiredTotal && confirmed.length > 0 && (
        <Notice kind="info">
          {c.requiredTotal - c.requiredFilled} required fields are still empty. Content will be
          thinner than it needs to be until they are filled.{" "}
          <a href={`#/b/${b.id}/brand`}>See what is missing</a>.
        </Notice>
      )}

      <div className="card">
        <Notice kind="err">{run.error}</Notice>

        <div className="grid two">
          <div className="field">
            <label htmlFor="pf">Platform</label>
            <select id="pf" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ct">How many</label>
            <select id="ct" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 3, 5, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {announceable.length > 0 && (
          <div className="field">
            <label htmlFor="of">
              Announce an offer
              <span className="hint">
                An approved market gap becomes an offer, and an offer becomes an announcement.
              </span>
            </label>
            <select id="of" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">No announcement, just regular posts</option>
              {announceable.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.announced ? " (already announced)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="cn">
            Campaign name<span className="hint">Optional. Groups this batch together.</span>
          </label>
          <input id="cn" type="text" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Autumn boiler service push" />
        </div>

        <div className="field">
          <label htmlFor="bf">
            Anything specific for this batch
            <span className="hint">Optional. It still cannot introduce facts that are not in the profile.</span>
          </label>
          <textarea id="bf" value={brief} onChange={(e) => setBrief(e.target.value)} style={{ minHeight: 80 }} placeholder="Lean on the emergency callout side of the business this month." />
        </div>

        <button className="primary" onClick={() => run.run()} disabled={run.busy || confirmed.length === 0}>
          <Busy busy={run.busy}>Write {count} posts</Busy>
        </button>
      </div>

      {content.length > 0 && (
        <p className="small muted" style={{ marginTop: 16 }}>
          {content.length} pieces written so far. <a href={`#/b/${b.id}/queue`}>Open the queue</a>.
        </p>
      )}
    </>
  );
}
