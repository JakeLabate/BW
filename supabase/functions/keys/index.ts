// Store, check and delete the caller's Anthropic API key.
// The key is encrypted before it reaches the database and is never returned.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  admin,
  encryptSecret,
  fail,
  handle,
  json,
  requireUser,
} from "../_shared/lib.ts";

Deno.serve(handle(async (req) => {
  const { user } = await requireUser(req);
  const db = admin();

  if (req.method === "GET") {
    const { data } = await db
      .from("provider_keys")
      .select("last4, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    return json({ present: !!data, last4: data?.last4 ?? null, updated_at: data?.updated_at ?? null });
  }

  if (req.method === "DELETE") {
    await db.from("provider_keys").delete().eq("user_id", user.id);
    return json({ present: false });
  }

  if (req.method === "POST") {
    const { api_key } = await req.json().catch(() => ({}));
    if (typeof api_key !== "string" || !api_key.startsWith("sk-ant-")) {
      return fail("That does not look like an Anthropic key. It should start with sk-ant-.");
    }

    // Prove the key works before storing it.
    const probe = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": api_key, "anthropic-version": "2023-06-01" },
    });
    if (!probe.ok) {
      return fail("Anthropic rejected that key.", 400, { detail: await probe.text() });
    }

    const { ciphertext, iv } = await encryptSecret(user.id, api_key);
    const last4 = api_key.slice(-4);
    const { error } = await db
      .from("provider_keys")
      .upsert({ user_id: user.id, provider: "anthropic", ciphertext, iv, last4 }, { onConflict: "user_id" });
    if (error) return fail(error.message, 500);
    return json({ present: true, last4 });
  }

  return fail("method not allowed", 405);
}));
