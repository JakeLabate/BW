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
  const { brand_id, source_id, logo_data_url, posts_text, use_collected_posts } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");

  const { data: brand } = await supa.from("brands").select("id, name").eq("id", brand_id).single();
  if (!brand) throw new HttpError("brand not found", 404);

  let integration: {
    id: string; scope: string[]; min_confidence: number; auto_confirm: boolean;
    config: Record<string, unknown>;
  } | null = null;
  if (source_id) {
    const { data } = await supa
      .from("sources")
      .select("id, scope, min_confidence, auto_confirm, config")
      .eq("id", source_id)
      .eq("brand_id", brand_id)
      .maybeSingle();
    if (!data) throw new HttpError("integration not found", 404);
    integration = data as typeof integration;
  }

  const apiKey = await anthropicKeyFor(user.id);

  // Integration settings govern this run the same way they govern every other.
  const scope: string[] = integration?.scope ?? [];
  const floor = Number(integration?.min_confidence ?? 0);
  const autoConfirm = !!integration?.auto_confirm;

  // Anything a feed integration already collected is post history we do not
  // need to ask for again. Outbound only: the brand talking, not customers.
  let posts = posts_text ? String(posts_text) : "";
  let collected = 0;
  if (use_collected_posts !== false) {
    const { data: own } = await supa
      .from("messages")
      .select("provider, subject, body, received_at")
      .eq("brand_id", brand_id)
      .eq("direction", "outbound")
      .order("received_at", { ascending: false })
      .limit(40);
    if (own?.length) {
      collected = own.length;
      const block = own
        .map((m) => [m.subject, m.body].filter(Boolean).join("\n").trim())
        .filter((t) => t.length > 20)
        .join("\n\n");
      posts = posts ? `${posts}\n\n${block}` : block;
    }
  }

  if (!logo_data_url && !posts) {
    throw new HttpError(
      "Nothing to read. Upload a logo, paste some posts, or connect a feed integration first.",
      422,
    );
  }

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

    if (posts) {
      content.push({
        type: "text",
        text: `PAST POSTS (most recent first, separated by blank lines):\n\n${posts.slice(0, 60_000)}`,
      });
    }

    content.push({ type: "text", text: `Business: ${brand.name}. Infer identity and voice now.` });
    log({ has_logo: !!logo_data_url, posts_chars: posts.length, collected_posts: collected });

    const reply = await claude({
      apiKey,
      system: SYSTEM,
      maxTokens: 6000,
      // deno-lint-ignore no-explicit-any
      content: content as any,
    });
    const out = parseJson<{ palette?: string[]; facts?: Array<Record<string, unknown>> }>(reply);

    // Reuse the integration that asked for this run. Only mint a source row when
    // the call came from somewhere else.
    let sourceId = integration?.id ?? null;
    if (sourceId) {
      await supa
        .from("sources")
        .update({ config: { ...(integration!.config ?? {}), palette: out.palette ?? [] } })
        .eq("id", sourceId);
      await supa.rpc("bump_integration", { p_source: sourceId });
    } else {
      const { data: source } = await supa
        .from("sources")
        .insert({
          brand_id,
          kind: "ai_inference",
          provider: "ai_inference",
          name: logo_data_url && posts ? "Logo and post history" : logo_data_url ? "Logo" : "Post history",
          label: logo_data_url && posts ? "Logo and post history" : logo_data_url ? "Logo" : "Post history",
          config: { palette: out.palette ?? [] },
          last_run_at: new Date().toISOString(),
          run_count: 1,
        })
        .select("id")
        .single();
      sourceId = source?.id ?? null;
    }

    const { data: defs } = await supa.rpc("industry_fields", { p_brand: brand_id });
    const allowed = ((defs ?? []) as Array<{ key: string; group_key: string }>)
      .filter((d) => !scope.length || scope.includes(d.group_key));
    const valid = new Set(allowed.map((d) => d.key));

    const rows = (out.facts ?? [])
      .filter((f) => valid.has(String(f.field_key)) && f.value)
      .map((f) => ({ ...f, conf: Math.min(1, Math.max(0, Number(f.confidence) || 0.5)) }))
      .filter((f) => f.conf >= floor)
      .map((f) => ({
        brand_id,
        field_key: String(f.field_key),
        value: String(f.value).slice(0, 2000),
        status: (autoConfirm ? "confirmed" : "proposed") as "confirmed" | "proposed",
        confidence: f.conf,
        source_id: sourceId,
        source_kind: "ai_inference" as const,
        evidence: { quote: f.quote ?? null },
      }));

    if (rows.length) await supa.from("brand_facts").insert(rows);

    const primary = out.palette?.[0];
    if (primary && /^#[0-9a-fA-F]{6}$/.test(primary)) {
      await supa.from("brands").update({ primary_color: primary }).eq("id", brand_id).is("primary_color", null);
    }

    await supa.rpc("refresh_profile_gaps", { p_brand: brand_id });
    return {
      proposed: rows.length,
      auto_confirmed: autoConfirm ? rows.length : 0,
      below_confidence_floor: (out.facts ?? []).length - rows.length,
      collected_posts: collected,
      palette: out.palette ?? [],
      source_id: sourceId,
    };
  }));
}));
