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
  FactHistory,
  FieldDef,
  FieldGroup,
  Gap,
  Industry,
  Message,
  ModuleStatus,
  Offer,
  Run,
  Schedule,
  Source,
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
  groups: FieldGroup[];
  industries: Industry[];
  modules: ModuleStatus[];
  facts: Fact[];
  history: FactHistory[];
  sources: Source[];
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

const EMPTY: Omit<BrandData, "reload"> = {
  brand: null,
  defs: [],
  groups: [],
  industries: [],
  modules: [],
  facts: [],
  history: [],
  sources: [],
  gaps: [],
  offers: [],
  content: [],
  messages: [],
  schedules: [],
  runs: [],
  loading: true,
  error: null,
};

export function BrandProvider({ brandId, children }: { brandId: string; children: ReactNode }) {
  const [state, setState] = useState(EMPTY);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const [
      brand, defs, groups, industries, facts, history, sources,
      gaps, offers, content, messages, schedules, runs,
    ] = await Promise.all([
      supabase.from("brands").select("*").eq("id", brandId).maybeSingle(),
      supabase.from("field_defs").select("*").order("sort"),
      supabase.from("field_groups").select("*").order("sort"),
      supabase.from("industries").select("*").order("sort"),
      supabase.from("brand_facts").select("*").eq("brand_id", brandId).order("created_at"),
      supabase.from("fact_history").select("*").eq("brand_id", brandId).order("at", { ascending: false }).limit(600),
      supabase.from("sources").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("gaps").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("offers").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("content_items").select("*").eq("brand_id", brandId).order("created_at", { ascending: false }),
      supabase.from("messages").select("*").eq("brand_id", brandId).order("received_at", { ascending: false }).limit(300),
      supabase.from("schedules").select("*").eq("brand_id", brandId),
      supabase.from("runs").select("*").eq("brand_id", brandId).order("started_at", { ascending: false }).limit(25),
    ]);

    // module status is a function call, and only works once an industry is set
    let modules: ModuleStatus[] = [];
    if ((brand.data as Brand | null)?.industry_key) {
      const { data } = await supabase.rpc("brand_module_status", { p_brand: brandId });
      modules = (data as ModuleStatus[]) ?? [];
    }

    const err = [brand, defs, groups, industries, facts, history, sources, gaps, offers, content, messages, schedules, runs]
      .map((r) => r.error?.message)
      .find(Boolean);

    setState({
      brand: (brand.data as Brand) ?? null,
      defs: (defs.data as FieldDef[]) ?? [],
      groups: (groups.data as FieldGroup[]) ?? [],
      industries: (industries.data as Industry[]) ?? [],
      modules,
      facts: (facts.data as Fact[]) ?? [],
      history: (history.data as FactHistory[]) ?? [],
      sources: (sources.data as Source[]) ?? [],
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

/** Completeness across the modules this brand actually has switched on. */
export function completeness(modules: ModuleStatus[]) {
  const on = modules.filter((m) => m.enabled);
  const requiredTotal = on.reduce((n, m) => n + m.required_total, 0);
  const requiredFilled = on.reduce((n, m) => n + m.required_filled, 0);
  const fieldsTotal = on.reduce((n, m) => n + m.fields_total, 0);
  const fieldsFilled = on.reduce((n, m) => n + m.fields_filled, 0);
  return {
    requiredTotal,
    requiredFilled,
    fieldsTotal,
    fieldsFilled,
    pct: requiredTotal ? Math.round((requiredFilled / requiredTotal) * 100) : 0,
  };
}

/** History for one field, newest first. */
export function historyFor(history: FactHistory[], fieldKey: string) {
  return history.filter((h) => h.field_key === fieldKey);
}
