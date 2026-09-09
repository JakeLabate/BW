import { useState } from "react";
import { fn, supabase } from "../lib/supabase";
import { useBrand } from "../lib/store";
import { Busy, Empty, Notice, useAction } from "../lib/ui";

const CHANNELS = ["gmail", "instagram dm", "messenger", "contact form", "sms", "phone note"];

export default function Inbox() {
  const { brand, messages, reload } = useBrand();
  const b = brand!;
  const [channel, setChannel] = useState("gmail");
  const [bulk, setBulk] = useState("");

  const importBulk = useAction(async () => {
    const blocks = bulk
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter((t) => t.length > 3);
    if (!blocks.length) throw new Error("Paste at least one message.");

    const rows = blocks.map((block) => {
      // optional leading "From: name" line, then the message
      const m = block.match(/^\s*(?:from:\s*)?([^\n]{1,80}?)\s*\n([\s\S]+)$/i);
      const looksLikeSender = m && m[1].length < 60 && !/[.!?]$/.test(m[1]);
      return {
        brand_id: b.id,
        channel,
        sender: looksLikeSender ? m![1].replace(/^from:\s*/i, "").trim() : null,
        body: looksLikeSender ? m![2].trim() : block,
      };
    });

    const { error } = await supabase.from("messages").insert(rows);
    if (error) throw error;
    setBulk("");
    await reload();
    return `Imported ${rows.length} messages.`;
  });

  const importCsv = useAction(async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("That file had no rows I could read.");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
    const iBody = idx(["body", "message", "text", "content"]);
    const iSender = idx(["sender", "from", "name", "customer"]);
    const iSubject = idx(["subject", "title"]);
    const iChannel = idx(["channel", "source", "platform"]);
    const iDate = idx(["date", "received", "received_at", "timestamp"]);
    if (iBody === -1) throw new Error("The CSV needs a body, message, text or content column.");

    const out = rows.slice(1)
      .filter((r) => (r[iBody] ?? "").trim())
      .map((r) => ({
        brand_id: b.id,
        channel: (iChannel > -1 ? r[iChannel] : "") || channel,
        sender: iSender > -1 ? r[iSender] || null : null,
        subject: iSubject > -1 ? r[iSubject] || null : null,
        body: r[iBody],
        received_at: iDate > -1 && r[iDate] && !isNaN(Date.parse(r[iDate])) ? new Date(r[iDate]).toISOString() : new Date().toISOString(),
      }));

    const { error } = await supabase.from("messages").insert(out);
    if (error) throw error;
    await reload();
    return `Imported ${out.length} messages.`;
  });

  const mine = useAction(async () => {
    const r = await fn<{ gaps_found: number; messages_read: number }>("mine", { brand_id: b.id });
    await reload();
    return `Read ${r.messages_read} messages and found ${r.gaps_found} market gaps.`;
  });

  const clear = useAction(async (id: string) => {
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) throw error;
    await reload();
  });

  return (
    <>
      <div className="head">
        <h1>Customer inbox</h1>
        <p>
          Gmail, Instagram DM, Messenger and contact form messages. This is where market gaps come
          from: things customers keep asking for that the business does not offer.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Import messages</h3>
        <p className="sub">
          Paste them one per block with a blank line between, or upload a CSV with a body column.
          Live mailbox connections are not wired up yet.
        </p>
        <Notice kind="err">{importBulk.error ?? importCsv.error}</Notice>
        <Notice kind="ok">{importBulk.done ?? importCsv.done}</Notice>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="ch">Channel</label>
          <select id="ch" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ maxWidth: 240 }}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="bulk">
            Messages
            <span className="hint">Optional first line is the sender's name, then the message.</span>
          </label>
          <textarea
            id="bulk"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={"Sarah M\nDo you do same day callouts on weekends?\n\nTom\nWhat would you charge to service two boilers at once?"}
          />
        </div>

        <div className="row">
          <button className="primary" onClick={() => importBulk.run()} disabled={importBulk.busy}>
            <Busy busy={importBulk.busy}>Import</Busy>
          </button>
          <label className="small muted" style={{ margin: 0 }}>
            or a CSV
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ marginTop: 4 }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importCsv.run(f);
              }}
            />
          </label>
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {messages.length} messages
        </div>
        <button className="primary" onClick={() => mine.run()} disabled={mine.busy || messages.length === 0}>
          <Busy busy={mine.busy}>Find market gaps</Busy>
        </button>
      </div>
      <Notice kind="err">{mine.error}</Notice>
      <Notice kind="ok">{mine.done}</Notice>

      {messages.length === 0 ? (
        <Empty title="The inbox is empty">
          <p className="tight">Import a batch above and BrandWield can start reading demand out of it.</p>
        </Empty>
      ) : (
        <div className="card scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>From</th>
                <th>Channel</th>
                <th>Message</th>
                <th className="right" />
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="small">{m.sender ?? <span className="muted">unknown</span>}</td>
                  <td>
                    <span className="pill">{m.channel}</span>
                  </td>
                  <td>
                    {m.subject && <strong>{m.subject} </strong>}
                    {m.body}
                  </td>
                  <td className="right">
                    <button className="ghost sm danger" onClick={() => clear.run(m.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Minimal RFC4180-ish CSV parser, good enough for exported inboxes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
