import { useEffect, useState } from "react";
import { supabase, fn } from "../lib/supabase";
import { go } from "../lib/store";
import type { Brand, Industry } from "../lib/types";
import { Busy, Empty, Notice, useAction } from "../lib/ui";

export default function Brands() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [industry, setIndustry] = useState("");

  const load = async () => {
    const [b, i] = await Promise.all([
      supabase.from("brands").select("*").order("created_at", { ascending: false }),
      supabase.from("industries").select("*").order("sort"),
    ]);
    setBrands((b.data as Brand[]) ?? []);
    setIndustries((i.data as Industry[]) ?? []);
  };

  useEffect(() => {
    void load();
    fn<{ present: boolean }>("keys", undefined, "GET")
      .then((r) => setKeyPresent(r.present))
      .catch(() => setKeyPresent(false));
  }, []);

  const create = useAction(async () => {
    if (!name.trim()) throw new Error("Give the business a name.");
    if (!industry) throw new Error("Pick the kind of business so the profile starts with the right fields.");
    let url = site.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const { data, error } = await supabase.rpc("create_brand", {
      p_name: name.trim(),
      p_website: url,
      p_industry: industry,
    });
    if (error) throw error;
    go(`/b/${data as string}/brand`);
  });

  return (
    <div className="wrap">
      <div className="head">
        <h1>Your brands</h1>
        <p>
          A brand is one business. Everything BrandWield knows about it, and everything it writes for
          it, hangs off this record.
        </p>
      </div>

      {keyPresent === false && (
        <Notice kind="warn">
          No Anthropic API key on your account yet, so collecting and generating will not run.{" "}
          <a href="#/account">Add one</a>.
        </Notice>
      )}

      {!open ? (
        <button className="primary" style={{ marginBottom: 22 }} onClick={() => setOpen(true)}>
          Add a business
        </button>
      ) : (
        <div className="card" style={{ marginBottom: 22 }}>
          <h3>Add a business</h3>
          <p className="sub" style={{ marginBottom: 14 }}>
            The kind of business decides which fields the profile starts with, so nobody gets asked
            about a fleet they do not own.
          </p>
          <Notice kind="err">{create.error}</Notice>

          <div className="grid two">
            <div className="field">
              <label htmlFor="n">Business name</label>
              <input id="n" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Riverside Plumbing" />
            </div>
            <div className="field">
              <label htmlFor="s">Website</label>
              <input id="s" type="text" value={site} onChange={(e) => setSite(e.target.value)} placeholder="riversideplumbing.com" />
            </div>
          </div>

          <label style={{ marginTop: 4 }}>What kind of business is it?</label>
          <div className="grid two" style={{ marginTop: 6 }}>
            {industries.map((i) => (
              <button
                key={i.key}
                type="button"
                className={`pick ${industry === i.key ? "on" : ""}`}
                onClick={() => setIndustry(i.key)}
              >
                <strong>{i.label}</strong>
                <span className="sub">{i.blurb}</span>
              </button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button className="primary" onClick={() => create.run()} disabled={create.busy}>
              <Busy busy={create.busy}>Create brand</Busy>
            </button>
            <button className="ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {brands === null ? (
        <span className="spin" />
      ) : brands.length === 0 ? (
        <Empty title="Nothing here yet">
          <p className="tight">Add the first business above and BrandWield will start reading it.</p>
        </Empty>
      ) : (
        <div className="grid three">
          {brands.map((b) => (
            <a key={b.id} className="card" href={`#/b/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row" style={{ gap: 8 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: b.primary_color ?? "var(--violet)",
                    display: "inline-block",
                  }}
                />
                <h3 style={{ margin: 0 }}>{b.name}</h3>
              </div>
              <div className="sub" style={{ marginTop: 6 }}>
                {b.one_liner ?? b.website_url ?? "No description yet"}
              </div>
              {b.industry_key && (
                <div style={{ marginTop: 10 }}>
                  <span className="pill">
                    {industries.find((i) => i.key === b.industry_key)?.label ?? b.industry_key}
                  </span>
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
