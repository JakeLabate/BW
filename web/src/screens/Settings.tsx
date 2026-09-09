import { useState } from "react";
import { supabase } from "../lib/supabase";
import { go, useBrand } from "../lib/store";
import { Busy, Notice, useAction } from "../lib/ui";

export default function Settings() {
  const { brand, facts, content, messages, reload } = useBrand();
  const b = brand!;
  const [name, setName] = useState(b.name);
  const [site, setSite] = useState(b.website_url ?? "");
  const [industry, setIndustry] = useState(b.industry ?? "");
  const [oneLiner, setOneLiner] = useState(b.one_liner ?? "");
  const [color, setColor] = useState(b.primary_color ?? "#5b21b6");
  const [confirmText, setConfirmText] = useState("");

  const save = useAction(async () => {
    let url = site.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const { error } = await supabase
      .from("brands")
      .update({
        name: name.trim(),
        website_url: url || null,
        industry: industry.trim() || null,
        one_liner: oneLiner.trim() || null,
        primary_color: color,
      })
      .eq("id", b.id);
    if (error) throw error;
    await reload();
    return "Saved.";
  });

  const destroy = useAction(async () => {
    if (confirmText !== b.name) throw new Error("Type the business name exactly to confirm.");
    const { error } = await supabase.from("brands").delete().eq("id", b.id);
    if (error) throw error;
    go("/");
  });

  return (
    <div className="narrow">
      <div className="head">
        <h1>Brand settings</h1>
        <p>The few things BrandWield keeps outside the fact record.</p>
      </div>

      <div className="card">
        <Notice kind="err">{save.error}</Notice>
        <Notice kind="ok">{save.done}</Notice>

        <div className="field">
          <label htmlFor="bn">Business name</label>
          <input id="bn" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bw">Website</label>
          <input id="bw" type="text" value={site} onChange={(e) => setSite(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bi">Industry</label>
          <input id="bi" type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Plumbing and heating" />
        </div>
        <div className="field">
          <label htmlFor="bo">
            One line description<span className="hint">Shown at the top of every screen.</span>
          </label>
          <input id="bo" type="text" value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bc">Brand colour</label>
          <input id="bc" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 60, height: 36, padding: 2 }} />
        </div>
        <button className="primary" onClick={() => save.run()} disabled={save.busy}>
          <Busy busy={save.busy}>Save</Busy>
        </button>
      </div>

      <div className="section-title">What is stored</div>
      <div className="card">
        <table className="table">
          <tbody>
            <tr>
              <td>Facts</td>
              <td className="right">{facts.length}</td>
            </tr>
            <tr>
              <td>Customer messages</td>
              <td className="right">{messages.length}</td>
            </tr>
            <tr>
              <td>Content pieces</td>
              <td className="right">{content.length}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-title">Danger</div>
      <div className="card" style={{ borderColor: "#f1c9c9" }}>
        <h3>Delete this brand</h3>
        <p className="sub">
          Removes the record, every fact, every message and every draft. There is no undo.
        </p>
        <Notice kind="err">{destroy.error}</Notice>
        <div className="inline-form" style={{ marginTop: 10 }}>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Type "${b.name}" to confirm`}
          />
          <button className="danger" onClick={() => destroy.run()} disabled={destroy.busy || confirmText !== b.name}>
            <Busy busy={destroy.busy}>Delete</Busy>
          </button>
        </div>
      </div>
    </div>
  );
}
