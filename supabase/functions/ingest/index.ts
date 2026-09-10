// INGEST: the inbound door for every communication platform.
//
// One URL per integration, authenticated by the token in it. Anything that can
// send an HTTP POST can feed this: a Gmail filter through Zapier, a Slack
// workflow, a Twilio number, a contact form, a Power Automate flow, a bot.
// No OAuth app, no per platform client, no stored password.
//
// The body shape is whatever the platform sends. We read the fields we
// recognise and keep the whole payload in meta, so nothing is lost if a shape
// turns out to be one we did not anticipate.
//
// This one endpoint is deliberately self contained. It is the only public door
// in the app, so it depends on nothing but the Supabase client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bw-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

/** First non empty string among these keys, searched a couple of levels deep. */
function pick(obj: Record<string, unknown>, keys: string[], depth = 2): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  if (depth <= 0) return null;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const hit = pick(v as Record<string, unknown>, keys, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

const BODY_KEYS = [
  "body", "text", "message", "content", "plain", "text_body", "body_plain", "stripped-text",
  "Body", "TextBody", "comment", "description", "question", "note", "answer", "summary",
];
const SENDER_KEYS = [
  "sender", "from", "from_email", "email", "user_name", "username", "author", "name",
  "From", "FromFull", "customer_email", "invitee_email", "user", "display_name",
];
const SUBJECT_KEYS = ["subject", "title", "Subject", "topic", "headline", "event_name"];
const ID_KEYS = ["external_id", "message_id", "id", "MessageID", "ts", "event_id", "uuid", "sid", "SmsSid"];
const LINK_KEYS = ["permalink", "url", "link", "web_link", "html_url", "permalink_url"];
const WHEN_KEYS = ["received_at", "created_at", "timestamp", "date", "sent_at", "Date", "occurred_at"];

/** Strip a quoted reply chain and a signature, so the model reads the question. */
function trimReply(text: string) {
  const cut = text.split(/\n\s*(?:On .{0,80}wrote:|-{2,}\s*Original Message|_{5,}|From:\s)/i)[0];
  return cut.replace(/\n>+[^\n]*/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function toIso(v: string | null): string | null {
  if (!v) return null;
  // Slack sends epoch seconds with a fractional part
  if (/^\d{9,10}(\.\d+)?$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  if (/^\d{12,13}$/.test(v)) return new Date(Number(v)).toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Never keep a credential just because a platform put one in the payload. */
const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|signature|bearer|credential/i;
function scrub(v: unknown, depth = 4): unknown {
  if (Array.isArray(v)) return depth <= 0 ? [] : v.map((x) => scrub(x, depth - 1));
  if (!v || typeof v !== "object") return v;
  if (depth <= 0) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = scrub(val, depth - 1);
  }
  return out;
}

/** Every shape we understand collapses to this. */
function normalise(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.flatMap(normalise);
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;

  // Envelopes that carry the real payload inside
  for (const key of ["messages", "items", "events", "data", "records", "payload"]) {
    const inner = o[key];
    if (Array.isArray(inner) && inner.length) return inner.flatMap(normalise);
  }
  // Slack Events API wraps the message in event
  if (o.event && typeof o.event === "object") {
    const ev = o.event as Record<string, unknown>;
    return [{ ...ev, _slack_team: o.team_id }];
  }
  return [o];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? req.headers.get("x-bw-token") ?? "";

  const ctype = req.headers.get("content-type") ?? "";
  let raw: unknown = {};
  try {
    if (ctype.includes("application/json")) raw = await req.json();
    else if (ctype.includes("form")) raw = Object.fromEntries(new URLSearchParams(await req.text()));
    else {
      const text = await req.text();
      try { raw = JSON.parse(text); } catch { raw = { body: text }; }
    }
  } catch {
    raw = {};
  }

  // Slack asks a question before it will send anything. Answer it without a token.
  const probe = raw as Record<string, unknown>;
  if (probe?.type === "url_verification" && typeof probe.challenge === "string") {
    return json({ challenge: probe.challenge });
  }

  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    return json({ error: "bad or missing token" }, 401);
  }

  const supa = admin();
  const { data: source } = await supa
    .from("sources")
    .select("id, brand_id, provider, status, kind")
    .eq("ingest_token", token)
    .maybeSingle();

  if (!source) return json({ error: "unknown token" }, 401);
  if (source.status === "paused") return json({ ok: true, skipped: "integration paused" });

  const items = normalise(raw).slice(0, 200);
  const rows = items
    .map((it) => {
      const body = pick(it, BODY_KEYS);
      if (!body || body.length < 2) return null;
      const when = toIso(pick(it, WHEN_KEYS));
      return {
        brand_id: source.brand_id,
        source_id: source.id,
        provider: source.provider,
        channel: source.provider ?? "webhook",
        direction: "inbound",
        sender: pick(it, SENDER_KEYS)?.slice(0, 200) ?? null,
        subject: pick(it, SUBJECT_KEYS)?.slice(0, 300) ?? null,
        body: trimReply(body).slice(0, 8000),
        external_id: pick(it, ID_KEYS)?.slice(0, 200) ?? null,
        permalink: pick(it, LINK_KEYS)?.slice(0, 500) ?? null,
        received_at: when ?? new Date().toISOString(),
        meta: scrub(it) as Record<string, unknown>,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (!rows.length) {
    return json({ ok: true, inserted: 0, note: "nothing in that payload looked like a message" });
  }

  // Drop anything this integration has already delivered. The partial unique
  // index is the backstop, but checking first keeps a retried delivery quiet
  // instead of turning it into an error.
  const ids = rows.map((r) => r.external_id).filter(Boolean) as string[];
  if (ids.length) {
    const { data: seen } = await supa
      .from("messages")
      .select("external_id")
      .eq("source_id", source.id)
      .in("external_id", ids);
    const known = new Set((seen ?? []).map((s) => s.external_id));
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].external_id && known.has(rows[i].external_id as string)) rows.splice(i, 1);
    }
  }

  if (!rows.length) return json({ ok: true, received: items.length, inserted: 0, note: "already delivered" });

  const { data: inserted, error } = await supa.from("messages").insert(rows).select("id");
  if (error) return json({ error: error.message }, 500);

  await supa
    .from("sources")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", source.id);

  return json({ ok: true, received: rows.length, inserted: inserted?.length ?? 0 });
});
