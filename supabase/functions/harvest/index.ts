// HARVEST: fill the brand profile from a website using rules only.
// No model, no API key, no tokens. Structured markup, meta tags, link
// protocols and a few conservative text patterns. Whatever it cannot answer
// is reported back so the AI pass knows exactly what is left to do.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  handle,
  HttpError,
  internalLinks,
  json,
  readPage,
  requireUser,
  withRun,
} from "../_shared/lib.ts";
import { harvestPage, mergeHarvest, type Harvested } from "../_shared/harvest.ts";

type Field = {
  key: string;
  label: string;
  required: boolean;
  group_key: string;
  group_label: string;
  enabled: boolean;
};

/** Pages worth trying even when nothing links to them by an obvious name. */
const GUESSES = ["/contact", "/contact-us", "/about", "/about-us", "/services", "/pricing", "/faq"];

Deno.serve(handle(async (req) => {
  const { supa } = await requireUser(req);
  const { brand_id, source_id, url, max_pages } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");

  const { data: brand } = await supa
    .from("brands")
    .select("id, name, website_url, primary_color, logo_url")
    .eq("id", brand_id)
    .single();
  if (!brand) throw new HttpError("brand not found", 404);

  let integration: {
    id: string; url: string | null; scope: string[]; min_confidence: number;
    auto_confirm: boolean; config: Record<string, unknown>;
  } | null = null;
  if (source_id) {
    const { data } = await supa
      .from("sources")
      .select("id, url, scope, min_confidence, auto_confirm, config")
      .eq("id", source_id)
      .eq("brand_id", brand_id)
      .maybeSingle();
    if (!data) throw new HttpError("integration not found", 404);
    integration = data as typeof integration;
  }

  const { data: defs, error: defsErr } = await supa.rpc("industry_fields", { p_brand: brand_id });
  if (defsErr) throw new HttpError(defsErr.message, 500);
  if (!defs?.length) {
    throw new HttpError("This brand has no industry preset yet, so there is nowhere to put what I find.", 422);
  }

  const scope: string[] = integration?.scope ?? [];
  const allowed = (defs as Field[]).filter((d) => !scope.length || scope.includes(d.group_key));
  const allowedKeys = new Set(allowed.map((d) => d.key));

  return json(await withRun(supa, brand_id, "harvest", async (log) => {
    const start = url ?? integration?.url ?? brand.website_url;
    if (!start) throw new HttpError("no url to read");

    // ---- crawl ----------------------------------------------------------
    const limit = Math.min(Math.max(Number(max_pages) || 8, 1), 12);
    const home = await readPage(start);
    if (!home) {
      throw new HttpError(
        `Could not read ${start}. Some sites block automated readers. Paste the page text instead.`,
        422,
      );
    }

    const pages = [{ url: home.url, html: home.html }];
    const failed: string[] = [];
    const origin = new URL(home.url).origin;

    const candidates = internalLinks(home.html, home.url, limit - 1);
    for (const g of GUESSES) {
      if (candidates.length >= limit - 1) break;
      const guess = origin + g;
      if (!candidates.some((c) => c.replace(/\/$/, "") === guess)) candidates.push(guess);
    }

    const fetched = await Promise.all(candidates.slice(0, limit - 1).map((u) => readPage(u)));
    fetched.forEach((p, i) => {
      if (p) pages.push({ url: p.url, html: p.html });
      else failed.push(candidates[i]);
    });
    log({ pages: pages.map((p) => p.url), failed });

    // ---- extract --------------------------------------------------------
    let raw: Harvested[] = [];
    let logo: string | undefined;
    let theme: string | undefined;
    for (const p of pages) {
      const { facts, extras } = harvestPage(p.html, p.url);
      raw = raw.concat(facts);
      logo ??= extras.logo_url;
      theme ??= extras.theme_color;
    }

    const merged = mergeHarvest(raw).filter((f) => allowedKeys.has(f.field_key));

    // rule tally, so a wrong value can be traced to the rule that made it
    const byRule: Record<string, number> = {};
    for (const f of merged) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;

    // ---- the integration this run belongs to ----------------------------
    const now = new Date().toISOString();
    let sourceId: string | null = null;
    if (integration) {
      await supa
        .from("sources")
        .update({ last_run_at: now, config: { ...integration.config, pages: pages.map((p) => p.url), failed } })
        .eq("id", integration.id);
      await supa.rpc("bump_integration", { p_source: integration.id });
      sourceId = integration.id;
    } else {
      const { data } = await supa
        .from("sources")
        .insert({
          brand_id,
          kind: "web_scrape",
          name: new URL(home.url).hostname,
          label: new URL(home.url).hostname,
          url: home.url,
          config: { pages: pages.map((p) => p.url), failed },
          last_run_at: now,
          run_count: 1,
        })
        .select("id")
        .single();
      sourceId = data?.id ?? null;
    }

    // ---- store ----------------------------------------------------------
    const { data: existing } = await supa
      .from("brand_facts")
      .select("field_key, value")
      .eq("brand_id", brand_id);
    const seen = new Set(
      (existing ?? []).map((e) => `${e.field_key}::${e.value.toLowerCase().replace(/\s+/g, " ").trim()}`),
    );

    const floor = Number(integration?.min_confidence ?? 0);
    const autoConfirm = !!integration?.auto_confirm;
    let belowFloor = 0;

    const rows = merged
      .filter((f) => !seen.has(`${f.field_key}::${f.value.toLowerCase().replace(/\s+/g, " ").trim()}`))
      .filter((f) => {
        if (f.confidence >= floor) return true;
        belowFloor++;
        return false;
      })
      .map((f) => ({
        brand_id,
        field_key: f.field_key,
        value: f.value.slice(0, 2000),
        status: (autoConfirm ? "confirmed" : "proposed") as "confirmed" | "proposed",
        confidence: f.confidence,
        source_id: sourceId,
        source_kind: "web_scrape" as const,
        evidence: { rule: f.rule, quote: f.quote ?? null, page: f.page ?? null },
      }));

    if (rows.length) {
      const { error } = await supa.from("brand_facts").insert(rows);
      if (error) throw new HttpError(error.message, 500);
    }

    // brand-level extras, only when nothing is set yet
    const patch: Record<string, string> = {};
    if (theme && !brand.primary_color) patch.primary_color = theme;
    if (logo && !brand.logo_url) patch.logo_url = logo;
    if (Object.keys(patch).length) await supa.from("brands").update(patch).eq("id", brand_id);

    await supa.rpc("refresh_profile_gaps", { p_brand: brand_id });

    // ---- what rules could not answer ------------------------------------
    const { data: after } = await supa
      .from("brand_facts")
      .select("field_key")
      .eq("brand_id", brand_id);
    const covered = new Set((after ?? []).map((f) => f.field_key));
    const stillEmpty = allowed.filter((d) => !covered.has(d.key));

    const modulesSuggested: Record<string, number> = {};
    const moduleOf = new Map(allowed.map((d) => [d.key, { label: d.group_label, enabled: d.enabled }]));
    for (const r of rows) {
      const m = moduleOf.get(r.field_key);
      if (m && !m.enabled) modulesSuggested[m.label] = (modulesSuggested[m.label] ?? 0) + 1;
    }

    return {
      pages_read: pages.length,
      pages_failed: failed,
      proposed: rows.length,
      auto_confirmed: autoConfirm ? rows.length : 0,
      below_confidence_floor: belowFloor,
      skipped_duplicates: merged.length - rows.length - belowFloor,
      rules_fired: byRule,
      fields_covered: [...new Set(rows.map((r) => r.field_key))].length,
      still_empty: stillEmpty.map((d) => d.label),
      still_empty_required: stillEmpty.filter((d) => d.required).map((d) => d.label),
      modules_suggested: modulesSuggested,
      logo_url: logo ?? null,
      theme_color: theme ?? null,
      source_id: sourceId,
    };
  }));
}));
