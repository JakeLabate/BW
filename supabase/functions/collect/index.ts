// COLLECT: read a brand's public pages (or pasted text) and propose brand facts.
// Everything it produces lands as `proposed` and needs the owner to confirm it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  anthropicKeyFor,
  claude,
  handle,
  HttpError,
  internalLinks,
  json,
  parseJson,
  readPage,
  requireUser,
  withRun,
} from "../_shared/lib.ts";

type Field = {
  key: string;
  label: string;
  help: string | null;
  required: boolean;
  multi: boolean;
  group_key: string;
  group_label: string;
  enabled: boolean;
};

type Extracted = {
  field_key: string;
  value: string;
  confidence: number;
  quote?: string;
  page?: string;
};

const SYSTEM = `You extract a structured brand profile from a small business's own public material.

Rules:
- Only record what the material actually says. Never guess, never pad, never write marketing copy.
- One fact per distinct value. A business with five services produces five services facts.
- Keep each value short and literal: a phone number is a phone number, a service is a service name plus a few words.
- confidence is 0.0 to 1.0. Use 0.9+ only when the material states it outright.
- quote must be a short verbatim snippet from the material that supports the value.
- Skip a field entirely rather than filling it with something vague.

Return ONLY a JSON array of objects: {field_key, value, confidence, quote, page}.`;

Deno.serve(handle(async (req) => {
  const { user, supa } = await requireUser(req);
  const { brand_id, source_id, url, pasted_text, label, kind } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");

  const { data: brand, error: brandErr } = await supa
    .from("brands")
    .select("id, name, website_url")
    .eq("id", brand_id)
    .single();
  if (brandErr || !brand) throw new HttpError("brand not found", 404);

  // the standing integration this run belongs to, if any
  let integration: {
    id: string; url: string | null; scope: string[]; min_confidence: number;
    auto_confirm: boolean; schedule: string; config: Record<string, unknown>;
  } | null = null;
  if (source_id) {
    const { data } = await supa
      .from("sources")
      .select("id, url, scope, min_confidence, auto_confirm, schedule, config")
      .eq("id", source_id)
      .eq("brand_id", brand_id)
      .maybeSingle();
    if (!data) throw new HttpError("integration not found", 404);
    integration = data as typeof integration;
  }

  // fields this brand's industry can hold, enabled modules or not
  const { data: defs, error: defsErr } = await supa.rpc("industry_fields", { p_brand: brand_id });
  if (defsErr) throw new HttpError(defsErr.message, 500);
  if (!defs?.length) {
    throw new HttpError(
      "This brand has no industry preset yet, so there are no fields to collect into.",
      422,
    );
  }

  const scope: string[] = integration?.scope ?? [];
  const offered = (defs as Field[]).filter((d) => !scope.length || scope.includes(d.group_key));
  if (!offered.length) {
    throw new HttpError("This integration is scoped to modules that hold no fields.", 422);
  }

  const apiKey = await anthropicKeyFor(user.id);

  return json(await withRun(supa, brand_id, kind === "paste" ? "collect:paste" : "collect:web", async (log) => {
    // ---- gather material -------------------------------------------------
    const pages: { url: string; title: string; text: string }[] = [];
    const failed: string[] = [];

    if (pasted_text) {
      pages.push({ url: url ?? "pasted", title: label ?? "Pasted text", text: String(pasted_text).slice(0, 60_000) });
    } else {
      const start = url ?? integration?.url ?? brand.website_url;
      if (!start) throw new HttpError("no url to read");
      const home = await readPage(start);
      if (!home) {
        failed.push(start);
        throw new HttpError(
          `Could not read ${start}. Some sites block automated readers. Paste the page text instead.`,
          422,
        );
      }
      pages.push({ url: home.url, title: home.title, text: home.text });

      const links = internalLinks(home.html, home.url, 7);
      const others = await Promise.all(links.map((l) => readPage(l)));
      others.forEach((p, i) => {
        if (p) pages.push({ url: p.url, title: p.title, text: p.text });
        else failed.push(links[i]);
      });
    }
    log({ pages: pages.map((p) => p.url), failed });

    // ---- the integration this run belongs to ------------------------------
    const now = new Date().toISOString();
    let source: { id: string } | null = null;

    if (integration) {
      const { data } = await supa
        .from("sources")
        .update({
          last_run_at: now,
          config: { ...integration.config, pages: pages.map((p) => p.url), failed },
        })
        .eq("id", integration.id)
        .select("id")
        .single();
      source = data;
      await supa.rpc("bump_integration", { p_source: integration.id });
    } else {
      const { data } = await supa
        .from("sources")
        .insert({
          brand_id,
          kind: pasted_text ? "owner_input" : "web_scrape",
          name: label ?? (pages[0]?.title || pages[0]?.url || "Website"),
          label: label ?? (pages[0]?.title || pages[0]?.url || "Website"),
          url: pages[0]?.url ?? null,
          config: { pages: pages.map((p) => p.url), failed },
          last_run_at: now,
          run_count: 1,
        })
        .select("id")
        .single();
      source = data;
    }

    // ---- extract ---------------------------------------------------------
    const corpus = pages
      .map((p) => `### PAGE: ${p.url}\n# TITLE: ${p.title}\n${p.text.slice(0, 9_000)}`)
      .join("\n\n")
      .slice(0, 90_000);

    const fieldList = offered
      .map((d) =>
        `- ${d.key} (${d.group_label}) — ${d.label}${d.multi ? " [multiple allowed]" : ""}${d.help ? `: ${d.help}` : ""}`)
      .join("\n");

    const reply = await claude({
      apiKey,
      system: SYSTEM,
      maxTokens: 8000,
      content:
        `Business: ${brand.name}\n\nFIELDS YOU MAY FILL:\n${fieldList}\n\n` +
        `MATERIAL:\n${corpus}`,
    });

    const valid = new Set(offered.map((d) => d.key));
    const extracted = parseJson<Extracted[]>(reply).filter(
      (f) => f && f.field_key && f.value && valid.has(f.field_key),
    );

    // ---- store as proposed facts, skipping duplicates --------------------
    const { data: existing } = await supa
      .from("brand_facts")
      .select("field_key, value")
      .eq("brand_id", brand_id);
    const seen = new Set((existing ?? []).map((e) => `${e.field_key}::${e.value.toLowerCase().trim()}`));

    const floor = Number(integration?.min_confidence ?? 0);
    const autoConfirm = !!integration?.auto_confirm;
    let belowFloor = 0;

    const rows = extracted
      .filter((f) => !seen.has(`${f.field_key}::${f.value.toLowerCase().trim()}`))
      .map((f) => ({
        ...f,
        confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0.5)),
      }))
      .filter((f) => {
        if (f.confidence >= floor) return true;
        belowFloor++;
        return false;
      })
      .map((f) => ({
        brand_id,
        field_key: f.field_key,
        value: String(f.value).slice(0, 2000),
        status: (autoConfirm ? "confirmed" : "proposed") as "confirmed" | "proposed",
        confidence: f.confidence,
        source_id: source?.id ?? null,
        source_kind: (pasted_text ? "owner_input" : "web_scrape") as const,
        evidence: { quote: f.quote ?? null, page: f.page ?? pages[0]?.url ?? null },
      }));

    if (rows.length) {
      const { error } = await supa.from("brand_facts").insert(rows);
      if (error) throw new HttpError(error.message, 500);
    }

    await supa.rpc("refresh_profile_gaps", { p_brand: brand_id });

    const moduleOf = new Map(
      offered.map((d) => [d.key, { label: d.group_label, enabled: d.enabled }]),
    );
    const newModules: Record<string, number> = {};
    for (const r of rows) {
      const m = moduleOf.get(r.field_key);
      if (m && !m.enabled) newModules[m.label] = (newModules[m.label] ?? 0) + 1;
    }

    return {
      modules_suggested: newModules,
      pages_read: pages.length,
      pages_failed: failed,
      proposed: rows.length,
      auto_confirmed: autoConfirm ? rows.length : 0,
      below_confidence_floor: belowFloor,
      skipped_duplicates: extracted.length - rows.length - belowFloor,
      source_id: source?.id ?? null,
    };
  }));
}));
