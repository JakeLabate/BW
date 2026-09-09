import { useEffect, useState } from "react";
import { fn } from "../lib/supabase";
import { Busy, Notice, useAction } from "../lib/ui";

export default function Account() {
  const [status, setStatus] = useState<{ present: boolean; last4: string | null } | null>(null);
  const [value, setValue] = useState("");

  const refresh = async () => {
    try {
      setStatus(await fn<{ present: boolean; last4: string | null }>("keys", undefined, "GET"));
    } catch {
      setStatus({ present: false, last4: null });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = useAction(async () => {
    if (!value.trim()) throw new Error("Paste the key first.");
    await fn("keys", { api_key: value.trim() });
    setValue("");
    await refresh();
    return "Key saved and verified against Anthropic.";
  });

  const remove = useAction(async () => {
    await fn("keys", undefined, "DELETE");
    await refresh();
    return "Key removed.";
  });

  return (
    <div className="wrap narrow">
      <div className="head">
        <h1>Account</h1>
        <p>
          BrandWield runs every collection and every draft through your own Anthropic key, so the
          usage and the bill are yours.
        </p>
      </div>

      <div className="card">
        <h3>Anthropic API key</h3>
        <p className="sub">
          Encrypted before it reaches the database and never sent back to the browser. Only the
          server functions can read it.
        </p>

        <Notice kind="err">{save.error ?? remove.error}</Notice>
        <Notice kind="ok">{save.done ?? remove.done}</Notice>

        {status === null ? (
          <span className="spin" />
        ) : status.present ? (
          <div className="row between" style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill green">Connected</span>
              <span className="mono muted">sk-ant-...{status.last4}</span>
            </div>
            <button className="danger sm" onClick={() => remove.run()} disabled={remove.busy}>
              <Busy busy={remove.busy}>Remove</Busy>
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="k">
                Key
                <span className="hint">
                  Starts with sk-ant-. Create one at console.anthropic.com under API keys.
                </span>
              </label>
              <input
                id="k"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
            </div>
            <button className="primary" onClick={() => save.run()} disabled={save.busy}>
              <Busy busy={save.busy}>Save key</Busy>
            </button>
          </div>
        )}
      </div>

      {status?.present && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Replace it</h3>
          <p className="sub">Paste a new key to swap the stored one.</p>
          <div className="inline-form" style={{ marginTop: 10 }}>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
            />
            <button onClick={() => save.run()} disabled={save.busy}>
              <Busy busy={save.busy}>Replace</Busy>
            </button>
          </div>
        </div>
      )}

      <p className="small muted" style={{ marginTop: 20 }}>
        <a href="#/">Back to brands</a>
      </p>
    </div>
  );
}
