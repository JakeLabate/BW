// FEED: read a platform's own published feed, deterministically.
//
// A surprising number of platforms still hand you everything for free in RSS,
// Atom or JSON Feed: YouTube, Reddit, Mastodon, Bluesky, Substack, Medium,
// Pinterest, every podcast, and most blogs. No key, no OAuth, no model, and
// nothing invented. What arrives is what the platform published.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handle, HttpError, htmlToText, json, requireUser, withRun } from "../_shared/lib.ts";

const UA = "Mozilla/5.0 (compatible; BrandWieldBot/1.0; +https://brandwield.jakelabate.com)";

async function get(url: string, timeoutMs = 12_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/json, text/xml, text/html;q=0.8" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return { url: res.url, text, type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
};

function unwrap(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .trim();
}

/** Turn whatever the owner pasted into the address the platform actually serves. */
async function feedUrlFor(provider: string, input: string): Promise<string | null> {
  const u = input.replace(/\/+$/, "");
  switch (provider) {
    case "youtube": {
      if (/feeds\/videos\.xml/.test(u)) return u;
      const idMatch = u.match(/\/channel\/(UC[\w-]{20,})/);
      if (idMatch) return `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`;
      const page = await get(u);
      const found = page?.text.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/)
        ?? page?.text.match(/channel_id=(UC[\w-]{20,})/);
      return found ? `https://www.youtube.com/feeds/videos.xml?channel_id=${found[1]}` : null;
    }
    case "reddit":
      return /\.rss$/.test(u) ? u : `${u}.rss`;
    case "mastodon":
      return /\.rss$/.test(u) ? u : `${u}.rss`;
    case "bluesky":
      return /\/rss$/.test(u) ? u : `${u}/rss`;
    case "pinterest":
      return /\.rss$/.test(u) ? u : `${u}.rss`;
    case "substack":
      return /\/feed/.test(u) ? u : `${u}/feed`;
    case "medium": {
      if (/\/feed\//.test(u)) return u;
      const handle = u.match(/medium\.com\/(@[\w.-]+|[\w-]+)$/);
      return handle ? `https://medium.com/feed/${handle[1]}` : u;
    }
    default:
      return u;
  }
}

/** Fall back to whatever feed the page declares in its head. */
function discover(html: string, base: string): string | null {
  const re = /<link\b[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const t = m[0];
    if (!/rel=["']?alternate/i.test(t)) continue;
    if (!/type=["'](application\/(rss|atom)\+xml|application\/feed\+json)/i.test(t)) continue;
    const href = t.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) { try { return new URL(href, base).href; } catch { /* skip */ } }
  }
  return null;
}

type Item = {
  external_id: string | null;
  subject: string | null;
  body: string;
  permalink: string | null;
  received_at: string | null;
  author: string | null;
};

function parseFeed(text: string, type: string): Item[] {
  // JSON Feed
  if (/json/.test(type) || text.trimStart().startsWith("{")) {
    try {
      const j = JSON.parse(text);
      const items = Array.isArray(j.items) ? j.items : [];
      return items.map((i: Record<string, unknown>) => ({
        external_id: (i.id as string) ?? (i.url as string) ?? null,
        subject: (i.title as string) ?? null,
        body: htmlToText(String(i.content_html ?? i.content_text ?? i.summary ?? "")),
        permalink: (i.url as string) ?? null,
        received_at: (i.date_published as string) ?? null,
        author: ((i.author as Record<string, string>)?.name) ?? null,
      }));
    } catch {
      return [];
    }
  }

  const blocks = [
    ...text.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  return blocks.map((b) => {
    const link =
      unwrap(tag(b, "link")) ||
      b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ||
      b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ||
      null;
    const raw =
      tag(b, "content:encoded") ?? tag(b, "content") ?? tag(b, "description") ??
      tag(b, "summary") ?? tag(b, "media:description");
    return {
      external_id: unwrap(tag(b, "guid")) || unwrap(tag(b, "id")) || link,
      subject: unwrap(tag(b, "title")) || null,
      body: htmlToText(unwrap(raw)),
      permalink: link,
      received_at: unwrap(tag(b, "pubDate")) || unwrap(tag(b, "published")) || unwrap(tag(b, "updated")) || null,
      author: unwrap(tag(b, "dc:creator")) || unwrap(tag(tag(b, "author") ?? "", "name")) || null,
    };
  });
}

function iso(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** A subreddit is other people talking. A channel is the brand talking. */
const INBOUND = new Set(["reddit"]);

Deno.serve(handle(async (req) => {
  const { supa } = await requireUser(req);
  const { brand_id, source_id, url, limit } = await req.json();
  if (!brand_id || !source_id) throw new HttpError("brand_id and source_id required");

  const { data: source } = await supa
    .from("sources")
    .select("id, brand_id, provider, url, config")
    .eq("id", source_id)
    .eq("brand_id", brand_id)
    .maybeSingle();
  if (!source) throw new HttpError("integration not found", 404);

  return json(await withRun(supa, brand_id, "feed", async (log) => {
    let start = String(url ?? source.url ?? "").trim();
    if (!start) throw new HttpError("no url on this integration");
    if (!/^https?:\/\//i.test(start)) start = `https://${start}`;

    const provider = source.provider ?? "blog_rss";
    let feedUrl = await feedUrlFor(provider, start);
    if (!feedUrl) throw new HttpError(`Could not work out the feed address for ${start}.`, 422);

    let doc = await get(feedUrl);
    let items = doc ? parseFeed(doc.text, doc.type) : [];

    // Nothing usable. Treat what we fetched as a web page and look for a feed in it.
    if (!items.length && doc && /html/i.test(doc.type)) {
      const declared = discover(doc.text, doc.url);
      for (const candidate of [declared, ...["/feed", "/rss", "/rss.xml", "/feed.xml", "/index.xml"].map((g) => new URL(g, doc!.url).href)]) {
        if (!candidate) continue;
        const alt = await get(candidate);
        const parsed = alt ? parseFeed(alt.text, alt.type) : [];
        if (parsed.length) { doc = alt; feedUrl = candidate; items = parsed; break; }
      }
    }

    log({ feed_url: feedUrl, found: items.length });
    if (!items.length) {
      throw new HttpError(
        `No feed found at ${feedUrl}. Paste the feed address directly, or use a paste integration instead.`,
        422,
      );
    }

    const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const direction = INBOUND.has(provider) ? "inbound" : "outbound";
    const kept = items.filter((i) => i.body || i.subject).slice(0, cap);

    const ids = kept.map((i) => i.external_id).filter(Boolean) as string[];
    const { data: seen } = ids.length
      ? await supa.from("messages").select("external_id").eq("source_id", source.id).in("external_id", ids)
      : { data: [] };
    const known = new Set((seen ?? []).map((s) => s.external_id));

    const rows = kept
      .filter((i) => !i.external_id || !known.has(i.external_id))
      .map((i) => ({
        brand_id,
        source_id: source.id,
        provider,
        channel: provider,
        direction,
        sender: i.author,
        subject: i.subject?.slice(0, 300) ?? null,
        body: (i.body || i.subject || "").slice(0, 8000),
        external_id: i.external_id?.slice(0, 200) ?? null,
        permalink: i.permalink?.slice(0, 500) ?? null,
        received_at: iso(i.received_at) ?? new Date().toISOString(),
        meta: {},
      }));

    if (rows.length) {
      const { error } = await supa.from("messages").insert(rows);
      if (error) throw new HttpError(error.message, 500);
    }

    await supa.from("sources").update({ url: start, config: { ...(source.config ?? {}), feed_url: feedUrl } }).eq("id", source.id);
    await supa.rpc("bump_integration", { p_source: source.id });

    return {
      feed_url: feedUrl,
      items_found: items.length,
      imported: rows.length,
      already_had: kept.length - rows.length,
      direction,
      newest: rows[0]?.subject ?? null,
    };
  }));
}));
