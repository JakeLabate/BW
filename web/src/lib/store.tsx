import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";
import type {
  Brand,
  ContentItem,
  Fact,
  FieldDef,
  Gap,
  Message,
  Offer,
  Run,
  Schedule,
} from "./types";

// ---------------------------------------------------------------- routing

export function useHashRoute() {
  const [path, setPath] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => setPath(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}

export function go(path: string) {
  window.location.hash = path;
}

// ------------------------------------------------------------ brand store

interface BrandData {
  brand: Brand | null;
  defs: FieldDef[];
  facts: Fact[];
  gaps: Gap[];
  offers: Offer[];
  content: ContentItem[];
  messages: Message[];
  schedules: Schedule[];
  runs: Run[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<BrandData | null>(null);

export function useBrand() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBrand outside provider");
  return v;
}

export function BrandProvider({ brandId, children }: { brandId: string; children: ReactNode }) {
  const [state, setState] = useState<Omit<BrandData, "reload">>({
    brand: null,
    defs: [],
    facts: [],
    gaps: [],
    offers: [],
    content: [],
    messages: [],
    schedules: [],
    runs: [],
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const [brand, defs, facts, gaps, offers, content, messages, schedules, runs] = await Promise.all([
      supabase.from("brands").select("*").eq("id", brandId).maybeSingle(),
      supabase.from("field_defs").select("*").order("sort"),
      supabase.from("brand_facts").select("*").eq("brand_id", brandId).order("created_at"),
      supabase.from("gaps").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("offers").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("content_items").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("messages").select("*").eq("brand_id", brandId).order("received_at", { ascending: false }).limit(300),
      supabase.from("schedules").select("*").eq("brand_id", brandId),
      supabase.from("runs").select("*").eq("brand_id", brandId).order("started_at", { ascending: false }).limit(25),
    ]);

    const err = [brand, defs, facts, gaps, offers, content, messages, schedules, runs]
      .map((r) => r.error?.message)
      .find(Boolean);

    setState({
      brand: (brand.data as Brand) ?? null,
      defs: (defs.data as FieldDef[]) ?? [],
      facts: (facts.data as Fact[]) ?? [],
      gaps: (gaps.data as Gap[]) ?? [],
      offers: (offers.data as Offer[]) ?? [],
      content: (content.data as ContentItem[]) ?? [],
      messages: (messages.data as Message[]) ?? [],
      schedules: (schedules.data as Schedule[]) ?? [],
      runs: (runs.data as Run[]) ?? [],
      loading: false,
      error: err ?? null,
    });
  }, [brandId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ ...state, reload }), [state, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------- selectors

export function confirmedFacts(facts: Fact[]) {
  return facts.filter((f) => f.status === "confirmed");
}
export function proposedFacts(facts: Fact[]) {
  return facts.filter((f) => f.status === "proposed");
}
export function openGaps(gaps: Gap[], kind?: "profile" | "market") {
  return gaps.filter((g) => g.status === "open" && (!kind || g.kind === kind));
}
export function completeness(defs: FieldDef[], facts: Fact[]) {
  const confirmed = new Set(confirmedFacts(facts).map((f) => f.field_key));
  const required = defs.filter((d) => d.required);
  return {
    requiredTotal: required.length,
    requiredFilled: required.filter((d) => confirmed.has(d.key)).length,
    fieldsTotal: defs.length,
    fieldsFilled: defs.filter((d) => confirmed.has(d.key)).length,
    pct: required.length ? Math.round((required.filter((d) => confirmed.has(d.key)).length / required.length) * 100) : 0,
  };
}
