// Shared helpers for BrandWield edge functions.
// Nothing here ever returns a decrypted provider key to a caller.

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, status);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/** Service role client. Bypasses RLS, so only use it for provider_keys. */
export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

/** Client bound to the caller's JWT, so RLS still applies to their data. */
export function asUser(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization") ?? "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
}

export async function requireUser(req: Request) {
  const supa = asUser(req);
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) throw new HttpError("not signed in", 401);
  return { user: data.user, supa };
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return fail(String((e as Error).message ?? e), status);
    }
  };
}

// ---------------------------------------------------------------- encryption

/**
 * AES-GCM key derived from a server-only secret via HKDF, salted per user.
 * BW_KEY_SECRET is used when set; otherwise the service role key acts as the
 * root secret. Either way the material never leaves the function runtime.
 */
async function userKey(userId: string): Promise<CryptoKey> {
  const root = Deno.env.get("BW_KEY_SECRET") ?? SERVICE_KEY;
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(root),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("brandwield:provider_keys"),
      info: new TextEncoder().encode(userId),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const b64 = {
  enc: (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

export async function encryptSecret(userId: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await userKey(userId);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { ciphertext: b64.enc(ct), iv: b64.enc(iv.buffer) };
}

export async function decryptSecret(userId: string, ciphertext: string, iv: string) {
  const key = await userKey(userId);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64.dec(iv) },
    key,
    b64.dec(ciphertext),
  );
  return new TextDecoder().decode(pt);
}

/** Fetch and decrypt the caller's Anthropic key. Never returned to the client. */
export async function anthropicKeyFor(userId: string): Promise<string> {
  const { data, error } = await admin()
    .from("provider_keys")
    .select("ciphertext, iv")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError("no_api_key", 428);
  return decryptSecret(userId, data.ciphertext, data.iv);
}

// ------------------------------------------------------------------- Claude

let cachedModel: { id: string; at: number } | null = null;

/** Pick the newest available Sonnet, falling back to whatever the key can see. */
export async function pickModel(apiKey: string): Promise<string> {
  if (cachedModel && Date.now() - cachedModel.at < 30 * 60_000) return cachedModel.id;
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new HttpError(`anthropic models: ${await res.text()}`, res.status);
  const body = await res.json();
  const ids: string[] = (body.data ?? []).map((m: { id: string }) => m.id);
  const pick =
    ids.find((id) => id.includes("sonnet")) ??
    ids.find((id) => id.includes("opus")) ??
    ids[0];
  if (!pick) throw new HttpError("no models available for this key", 502);
  cachedModel = { id: pick, at: Date.now() };
  return pick;
}

type Block = { type: "text"; text: string } | { type: "image"; source: unknown };

export async function claude(opts: {
  apiKey: string;
  system: string;
  content: Block[] | string;
  maxTokens?: number;
}): Promise<string> {
  const model = await pickModel(opts.apiKey);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
    }),
  });
  if (!res.ok) throw new HttpError(`anthropic: ${await res.text()}`, res.status);
  const body = await res.json();
  return (body.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
}

/** Parse a JSON object or array out of a model reply, tolerating fences. */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
  if (start === -1 || end === -1) throw new HttpError("model did not return JSON", 502);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

// -------------------------------------------------------------------- pages

/** Fetch a page and reduce it to readable text. Returns null on any failure. */
export async function readPage(url: string, timeoutMs = 12_000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; BrandWieldBot/1.0; +https://brandwield.jakelabate.com)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    return { url: res.url, html, text: htmlToText(html), title: titleOf(html) };
  } catch {
    return null;
  }
}

export function titleOf(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Same-origin internal links, most useful pages first. */
export function internalLinks(html: string, base: string, limit = 8) {
  const origin = new URL(base).origin;
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const out: string[] = [];
  const priority = /about|service|product|menu|price|pricing|contact|team|review|testimonial|faq|work|gallery|shop/i;
  const abs = hrefs
    .map((h) => {
      try {
        return new URL(h, base).href;
      } catch {
        return "";
      }
    })
    .filter((h) => h && h.startsWith(origin) && !/\.(jpg|png|gif|pdf|zip|svg|webp|mp4|css|js)(\?|$)/i.test(h));
  for (const h of abs.filter((h) => priority.test(h)).concat(abs)) {
    const clean = h.split("?")[0].replace(/\/$/, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** Record a run row and keep it updated. */
export async function withRun(
  supa: SupabaseClient,
  brandId: string,
  kind: string,
  fn: (log: (d: Record<string, unknown>) => void) => Promise<Record<string, unknown>>,
) {
  const { data: run } = await supa
    .from("runs")
    .insert({ brand_id: brandId, kind, status: "running" })
    .select("id")
    .single();
  const detail: Record<string, unknown> = {};
  try {
    const result = await fn((d) => Object.assign(detail, d));
    await supa
      .from("runs")
      .update({ status: "done", finished_at: new Date().toISOString(), detail: { ...detail, ...result } })
      .eq("id", run!.id);
    return { run_id: run!.id, ...result };
  } catch (e) {
    await supa
      .from("runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: String((e as Error).message ?? e),
        detail,
      })
      .eq("id", run!.id);
    throw e;
  }
}
