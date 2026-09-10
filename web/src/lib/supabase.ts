import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** Needed to build the public ingest URL an integration hands to a platform. */
export const SUPABASE_URL = url;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Call one of the edge functions with the caller's session attached. */
export async function fn<T = unknown>(
  name: string,
  body?: unknown,
  method: "GET" | "POST" | "DELETE" = "POST",
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${session?.access_token ?? key}`,
      "Content-Type": "application/json",
    },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.slice(0, 300) || `${name} failed`);
  }
  if (!res.ok) {
    const e = parsed as { error?: string };
    const err = new Error(e?.error ?? `${name} failed (${res.status})`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return parsed as T;
}
