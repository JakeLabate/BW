// AI INFERENCE: read the logo file and the past post history, infer voice and identity.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  anthropicKeyFor,
  claude,
  handle,
  HttpError,
  json,
  parseJson,
  requireUser,
  withRun,
} from "../_shared/lib.ts";

const SYSTEM = `You infer a small business's visual identity and writing voice from two inputs:
a logo image, and a sample of posts the business has published.

You are allowed to infer here, unlike a pure extraction pass, but you must stay grounded:
- Voice facts (tone, vocabulary, banned_words) come from patterns you can actually see in the posts.
- vocabulary means house terms the business really uses. banned_words means corporate filler visibly absent from their writing.
- post_examples: quote the two or three strongest real posts verbatim, trimmed, as separate facts.
- From the logo: primary_color as a hex code, plus anything the mark itself states (established year, tagline, trade).
- confidence below 0.6 for anything you are reading between the lines.

Return ONLY JSON: {"palette": ["#hex", ...], "facts": [{field_key, value, confidence, quote}]}`;

Deno.serve(handle(async (req) => {
  const { user, supa } = await requireUser(req);
  const { brand_id, logo_data_url, posts_text } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");
  if (!logo_data_url && !posts_text) throw new HttpError("give me a logo, a post history, or both");

  const { data: brand } = await supa.from("brands").select("id, name").eq("id", brand_id).single();
  if (!brand) throw new HttpError("brand not found", 404);

  const apiKey = await anthropicKeyFor(user.id);

  return json(await withRun(supa, brand_id, "infer", async (log) => {
    const content: Array<Record<string, unknown>> = [];

    if (logo_data_url) {
      const m = String(logo_data_url).match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (!m) throw new HttpError("logo must be a base64 data URL");
      content.push({
        type: "image",
        source: { type: "base64", media_type: m[1], data: m[2] },
      });
      content.push({ type: "text", text: "That image is the business logo." });
    }

    if (posts_text) {
      content.push({
        type: "text",
        text: `PAST POSTS (most recent first, separated by blank lines):\n\n${String(posts_text).slice(0, 60_000)}`,
      });
    }

    content.push({ type: "text", text: `Business: ${brand.name}. Infer identity and voice now.` });
    log({ has_logo: !!logo_data_url, posts_chars: posts_text ? String(posts_text).length : 0 });

    const reply = await claude({
      apiKey,
      system: SYSTEM,
      maxTokens: 6000,
      // deno-lint-ignore no-explicit-any
      content: content as any,
    });
    const out = parseJson<{ palette?: string[]; facts?: Array<Record<string, unknown>> }>(reply);

    const { data: source } = await supa
      .from("sources")
      .insert({
        brand_id,
        kind: "ai_inference",
        label: logo_data_url && posts_text ? "Logo and post history" : logo_data_url ? "Logo" : "Post history",
        config: { palette: out.palette ?? [] },
        last_run_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const { data: defs } = await supa.from("field_defs").select("key");
    const valid = new Set((defs ?? []).map((d) => d.key));

    const rows = (out.facts ?? [])
      .filter((f) => valid.has(String(f.field_key)) && f.value)
      .map((f) => ({
        brand_id,
        field_key: String(f.field_key),
        value: String(f.value).slice(0, 2000),
        status: "proposed" as const,
        confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0.5)),
        source_id: source?.id ?? null,
        source_kind: "ai_inference" as const,
        evidence: { quote: f.quote ?? null },
      }));

    if (rows.length) await supa.from("brand_facts").insert(rows);

    const primary = out.palette?.[0];
    if (primary && /^#[0-9a-fA-F]{6}$/.test(primary)) {
      await supa.from("brands").update({ primary_color: primary }).eq("id", brand_id).is("primary_color", null);
    }

    await supa.rpc("refresh_profile_gaps", { p_brand: brand_id });
    return { proposed: rows.length, palette: out.palette ?? [] };
  }));
}));
