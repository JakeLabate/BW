import { useEffect, useState } from "react";
import { supabase, fn } from "../lib/supabase";
import { go } from "../lib/store";
import type { Brand } from "../lib/types";
import { Busy, Empty, Notice, useAction } from "../lib/ui";

export default function Brands() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);

  const load = async () => {
    const { data } = await supabase.from("brands").select("*").order("created_at", { ascending: false });
    setBrands((data as Brand[]) ?? []);
  };

  useEffect(() => {
    void load();
    fn<{ present: boolean }>("keys", undefined, "GET")
      .then((r) => setKeyPresent(r.present))
      .catch(() => setKeyPresent(false));
  }, []);

  const create = useAction(async () => {
    if (!name.trim()) throw new Error("Give the business a name.");
    const { data: { user } } = await supabase.auth.getUser();
    let url = site.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const { data, error } = await supabase
      .from("brands")
      .insert({ owner_id: user!.id, name: name.trim(), website_url: url || null })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.rpc("refresh_profile_gaps", { p_brand: data!.id });
    go(`/b/${data!.id}/collect`);
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

      <div className="card" style={{ marginBottom: 22 }}>
        <h3>Add a business</h3>
        <p className="sub" style={{ marginBottom: 12 }}>
          Name and website are enough to start. Everything else gets collected.
        </p>
        <Notice kind="err">{create.error}</Notice>
        <div className="inline-form">
          <div>
            <label htmlFor="n">Business name</label>
            <input id="n" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Riverside Plumbing" />
          </div>
          <div>
            <label htmlFor="s">Website</label>
            <input id="s" type="text" value={site} onChange={(e) => setSite(e.target.value)} placeholder="riversideplumbing.com" />
          </div>
          <button className="primary" onClick={() => create.run()} disabled={create.busy}>
            <Busy busy={create.busy}>Add brand</Busy>
          </button>
        </div>
      </div>

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
                  className="dot"
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
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
