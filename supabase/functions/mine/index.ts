// MARKET GAP: read the customer inbox and find things customers keep asking for
// that the business does not currently offer.
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

const SYSTEM = `You read a small business's incoming customer messages and find MARKET GAPS:
things customers repeatedly ask for that the business does not currently sell, or sells on
terms that keep causing friction.

Rules:
- A gap needs real repetition. One message is not a gap. Two is thin. Say so in demand_count.
- Do not invent demand. If the inbox shows no gap, return an empty array. That is a valid answer.
- A pricing or availability complaint that recurs is a gap too: the suggestion is repricing or
  changing terms, not a new product.
- evidence: quote the actual messages, verbatim and short, with the message id.
- suggestion: one concrete sentence the owner can approve or reject. Name a price or term if the
  messages imply one.

Return ONLY JSON: [{title, detail, suggestion, demand_count, offer_name, offer_price, evidence:[{message_id, quote}]}]`;

Deno.serve(handle(async (req) => {
  const { user, supa } = await requireUser(req);
  const { brand_id } = await req.json();
  if (!brand_id) throw new HttpError("brand_id required");

  const { data: brand } = await supa.from("brands").select("id, name").eq("id", brand_id).single();
  if (!brand) throw new HttpError("brand not found", 404);

  const apiKey = await anthropicKeyFor(user.id);

  return json(await withRun(supa, brand_id, "mine", async (log) => {
    const { data: messages } = await supa
      .from("messages")
      .select("id, channel, sender, subject, body, received_at")
      .eq("brand_id", brand_id)
      .order("received_at", { ascending: false })
      .limit(400);

    if (!messages?.length) throw new HttpError("no messages to read yet", 422);

    const { data: facts } = await supa
      .from("brand_facts")
      .select("field_key, value")
      .eq("brand_id", brand_id)
      .eq("status", "confirmed")
      .in("field_key", ["services", "pricing", "service_area", "lead_times", "guarantees"]);

    const { data: offers } = await supa
      .from("offers")
      .select("name, description, price, status")
      .eq("brand_id", brand_id);

    const { data: openGaps } = await supa
      .from("gaps")
      .select("title")
      .eq("brand_id", brand_id)
      .eq("kind", "market")
      .in("status", ["open", "snoozed"]);

    log({ messages: messages.length, existing_gaps: openGaps?.length ?? 0 });

    const inbox = messages
      .map((m) => `[${m.id}] ${m.received_at.slice(0, 10)} ${m.channel} from ${m.sender ?? "unknown"}${m.subject ? ` — ${m.subject}` : ""}\n${m.body.slice(0, 1200)}`)
      .join("\n\n")
      .slice(0, 120_000);

    const reply = await claude({
      apiKey,
      system: SYSTEM,
      maxTokens: 6000,
      content:
        `Business: ${brand.name}\n\n` +
        `WHAT THEY CURRENTLY OFFER:\n${(facts ?? []).map((f) => `- ${f.field_key}: ${f.value}`).join("\n") || "- nothing recorded yet"}\n\n` +
        `OFFERS ALREADY ON THE BOARD:\n${(offers ?? []).map((o) => `- ${o.name} (${o.status})`).join("\n") || "- none"}\n\n` +
        `GAPS ALREADY REPORTED (do not repeat these):\n${(openGaps ?? []).map((g) => `- ${g.title}`).join("\n") || "- none"}\n\n` +
        `INBOX:\n${inbox}`,
    });

    const found = parseJson<Array<Record<string, unknown>>>(reply).filter((g) => g?.title);

    const rows = found.map((g) => ({
      brand_id,
      kind: "market" as const,
      title: String(g.title).slice(0, 300),
      detail: g.detail ? String(g.detail) : null,
      suggestion: g.suggestion ? String(g.suggestion) : null,
      demand_count: Number(g.demand_count) || (Array.isArray(g.evidence) ? g.evidence.length : 0),
      evidence: g.evidence ?? [],
      status: "open" as const,
    }));

    if (rows.length) {
      const { error } = await supa.from("gaps").insert(rows);
      if (error) throw new HttpError(error.message, 500);
    }

    // stash the suggested offer shape so approving a gap can prefill it
    return { messages_read: messages.length, gaps_found: rows.length, drafts: found };
  }));
}));
