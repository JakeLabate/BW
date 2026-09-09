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
  const { brand_id, url, pasted_text, label, kind } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");

  const { data: brand, error: brandErr } = await supa
    .from("brands")
    .select("id, name, website_url")
    .eq("id", brand_id)
    .single();
  if (brandErr || !brand) throw new HttpError("brand not found", 404);

  // fields this brand's industry can hold, enabled modules or not
  const { data: defs, error: defsErr } = await supa.rpc("industry_fields", { p_brand: brand_id });
  if (defsErr) throw new HttpError(defsErr.message, 500);
  if (!defs?.length) {
    throw new HttpError(
      "This brand has no industry preset yet, so there are no fields to collect into.",
      422,
    );
  }

  const apiKey = await anthropicKeyFor(user.id);

  return json(await withRun(supa, brand_id, kind === "paste" ? "collect:paste" : "collect:web", async (log) => {
    // ---- gather material -------------------------------------------------
    const pages: { url: string; title: string; text: string }[] = [];
    const failed: string[] = [];

    if (pasted_text) {
      pages.push({ url: url ?? "pasted", title: label ?? "Pasted text", text: String(pasted_text).slice(0, 60_000) });
    } else {
      const start = url ?? brand.website_url;
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

    // ---- record the source ----------------------------------------------
    const { data: source } = await supa
      .from("sources")
      .insert({
        brand_id,
        kind: pasted_text ? "owner_input" : "web_scrape",
        label: label ?? (pages[0]?.title || pages[0]?.url || "Web"),
        url: pages[0]?.url ?? null,
        config: { pages: pages.map((p) => p.url), failed },
        last_run_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    // ---- extract ---------------------------------------------------------
    const corpus = pages
      .map((p) => `### PAGE: ${p.url}\n# TITLE: ${p.title}\n${p.text.slice(0, 9_000)}`)
      .join("\n\n")
      .slice(0, 90_000);

    const fieldList = (defs ?? [])
      .map((d: { key: string; group_label: string; label: string; multi: boolean; help: string | null }) =>
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

    const valid = new Set((defs ?? []).map((d: { key: string }) => d.key));
    const extracted = parseJson<Extracted[]>(reply).filter(
      (f) => f && f.field_key && f.value && valid.has(f.field_key),
    );

    // ---- store as proposed facts, skipping duplicates --------------------
    const { data: existing } = await supa
      .from("brand_facts")
      .select("field_key, value")
      .eq("brand_id", brand_id);
    const seen = new Set((existing ?? []).map((e) => `${e.field_key}::${e.value.toLowerCase().trim()}`));

    const rows = extracted
      .filter((f) => !seen.has(`${f.field_key}::${f.value.toLowerCase().trim()}`))
      .map((f) => ({
        brand_id,
        field_key: f.field_key,
        value: String(f.value).slice(0, 2000),
        status: "proposed" as const,
        confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0.5)),
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
      (defs ?? []).map((d: { key: string; group_key: string; group_label: string; enabled: boolean }) =>
        [d.key, { key: d.group_key, label: d.group_label, enabled: d.enabled }]),
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
      skipped_duplicates: extracted.length - rows.length,
      source_id: source?.id ?? null,
    };
  }));
}));
