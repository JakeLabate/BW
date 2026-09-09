// GENERATE: write posts and campaigns from the confirmed brand profile.
// Only confirmed facts are used, so nothing invented reaches a post.
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

const SYSTEM = `You write social posts for a small business, in that business's own voice.

Hard rules:
- Every factual claim must trace to a fact in the profile below. If it is not in the profile, it does
  not go in the post. No invented statistics, awards, testimonials, prices or dates.
- Obey the recorded tone, vocabulary and banned words. If banned words are listed, they never appear.
- No em dashes anywhere.
- Do not open with a one-word hook line, a rhetorical question, or "In today's world".
- LinkedIn posts: 60 to 140 words, plain sentences, at most one line break between thoughts.
- Facebook posts: 30 to 80 words, warmer, plainer, a clear next step.
- Instagram: 20 to 60 words plus hashtags.
- Each post needs a different angle. No two posts may lead with the same fact.
- grounded_in lists the field_key values you actually used.

Return ONLY JSON: [{platform, title, body, hashtags, angle, grounded_in:[field_key]}]`;

Deno.serve(handle(async (req) => {
  const { user, supa } = await requireUser(req);
  const { brand_id, platform = "linkedin", count = 5, offer_id, campaign_name, brief } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");

  const { data: brand } = await supa
    .from("brands")
    .select("id, name, website_url, industry, one_liner")
    .eq("id", brand_id)
    .single();
  if (!brand) throw new HttpError("brand not found", 404);

  const apiKey = await anthropicKeyFor(user.id);

  return json(await withRun(supa, brand_id, "generate", async (log) => {
    const { data: facts } = await supa
      .from("brand_facts")
      .select("field_key, value")
      .eq("brand_id", brand_id)
      .eq("status", "confirmed");

    if (!facts?.length) {
      throw new HttpError(
        "Nothing is confirmed in the brand profile yet. Confirm some facts first, or generation would be inventing.",
        422,
      );
    }

    const { data: defs } = await supa.from("field_defs").select("key, label, category").order("sort");
    const labelOf = new Map((defs ?? []).map((d) => [d.key, `${d.category} / ${d.label}`]));

    const profile = (facts ?? [])
      .map((f) => `- [${f.field_key}] ${labelOf.get(f.field_key) ?? f.field_key}: ${f.value}`)
      .join("\n");

    // an approved offer turns into an announcement
    let offer: { name: string; description: string | null; price: string | null } | null = null;
    if (offer_id) {
      const { data } = await supa
        .from("offers")
        .select("name, description, price, status")
        .eq("id", offer_id)
        .single();
      if (data && data.status !== "rejected") offer = data;
    }

    const { data: recent } = await supa
      .from("content_items")
      .select("body")
      .eq("brand_id", brand_id)
      .order("created_at", { ascending: false })
      .limit(12);

    log({ confirmed_facts: facts.length, platform, count, offer: offer?.name ?? null });

    const reply = await claude({
      apiKey,
      system: SYSTEM,
      maxTokens: 8000,
      content:
        `Business: ${brand.name}${brand.one_liner ? ` — ${brand.one_liner}` : ""}\n` +
        `Platform: ${platform}\nHow many posts: ${count}\n\n` +
        `CONFIRMED BRAND PROFILE:\n${profile}\n\n` +
        (offer
          ? `ANNOUNCE THIS NEW OFFER. It came from customers asking for it, so say so plainly:\n` +
            `- ${offer.name}${offer.price ? ` (${offer.price})` : ""}\n- ${offer.description ?? ""}\n\n`
          : "") +
        (campaign_name ? `Campaign: ${campaign_name}\n\n` : "") +
        (brief ? `Owner's brief for this batch: ${brief}\n\n` : "") +
        `ALREADY PUBLISHED OR DRAFTED, DO NOT REPEAT THESE ANGLES:\n${(recent ?? []).map((r) => `- ${r.body.slice(0, 160)}`).join("\n") || "- nothing yet"}\n\n` +
        `Write ${count} posts now.`,
    });

    const posts = parseJson<Array<Record<string, unknown>>>(reply).filter((p) => p?.body);

    let campaignId: string | null = null;
    if (campaign_name || offer) {
      const { data: c } = await supa
        .from("campaigns")
        .insert({
          brand_id,
          name: campaign_name ?? `${offer!.name} announcement`,
          objective: offer ? "Announce a new offer that came out of customer demand" : (brief ?? null),
          offer_id: offer_id ?? null,
        })
        .select("id")
        .single();
      campaignId = c?.id ?? null;
    }

    const rows = posts.map((p) => ({
      brand_id,
      campaign_id: campaignId,
      platform: String(p.platform ?? platform),
      title: p.title ? String(p.title).slice(0, 300) : (p.angle ? String(p.angle).slice(0, 300) : null),
      body: String(p.body),
      hashtags: p.hashtags ? String(p.hashtags) : null,
      status: "draft" as const,
      grounded_in: p.grounded_in ?? [],
    }));

    if (rows.length) {
      const { error } = await supa.from("content_items").insert(rows);
      if (error) throw new HttpError(error.message, 500);
    }

    if (offer_id && offer) {
      await supa.from("offers").update({ announced: true }).eq("id", offer_id);
    }

    return { drafted: rows.length, campaign_id: campaignId };
  }));
}));
