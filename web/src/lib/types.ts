export type SourceKind = "owner_input" | "web_scrape" | "ai_inference" | "customer_inbox";
export type FactStatus = "proposed" | "confirmed" | "rejected";
export type GapKind = "profile" | "market";
export type GapStatus = "open" | "snoozed" | "dismissed" | "resolved";
export type OfferStatus = "proposed" | "approved" | "rejected" | "live";
export type ContentStatus = "draft" | "approved" | "queued" | "published" | "archived";
export type Platform = "facebook" | "linkedin" | "instagram" | "x" | "email" | "blog";

export interface Brand {
  id: string;
  owner_id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  one_liner: string | null;
  logo_url: string | null;
  primary_color: string | null;
  locations: string | null;
  industry_key: string | null;
  created_at: string;
}

export interface FieldDef {
  key: string;
  group_key: string;
  label: string;
  help: string | null;
  required: boolean;
  multi: boolean;
  sort: number;
}

export interface Fact {
  id: string;
  brand_id: string;
  field_key: string;
  value: string;
  status: FactStatus;
  confidence: number | null;
  source_id: string | null;
  source_kind: SourceKind;
  evidence: { quote?: string | null; page?: string | null };
  created_at: string;
}

export interface Source {
  id: string;
  brand_id: string;
  kind: SourceKind;
  name: string;
  label: string;
  url: string | null;
  config: Record<string, unknown>;
  status: "active" | "paused";
  schedule: "manual" | "daily" | "weekly" | "monthly";
  scope: string[];
  min_confidence: number;
  auto_confirm: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  created_at: string;
}

export interface Message {
  id: string;
  brand_id: string;
  source_id: string | null;
  channel: string;
  sender: string | null;
  subject: string | null;
  body: string;
  received_at: string;
}

export interface Gap {
  id: string;
  brand_id: string;
  kind: GapKind;
  field_key: string | null;
  title: string;
  detail: string | null;
  suggestion: string | null;
  demand_count: number;
  evidence: Array<{ message_id?: string; quote?: string }>;
  status: GapStatus;
  created_at: string;
}

export interface Offer {
  id: string;
  brand_id: string;
  gap_id: string | null;
  name: string;
  description: string | null;
  price: string | null;
  status: OfferStatus;
  announced: boolean;
  created_at: string;
}

export interface ContentItem {
  id: string;
  brand_id: string;
  campaign_id: string | null;
  platform: Platform;
  title: string | null;
  body: string;
  hashtags: string | null;
  status: ContentStatus;
  scheduled_for: string | null;
  published_at: string | null;
  grounded_in: string[];
  created_at: string;
}

export interface Schedule {
  id: string;
  brand_id: string;
  platform: Platform;
  days_of_week: number[];
  time_of_day: string;
  timezone: string;
  active: boolean;
}

export interface Run {
  id: string;
  brand_id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  detail: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export const PLATFORMS: Platform[] = ["linkedin", "facebook", "instagram", "x", "email", "blog"];

export const SOURCE_LABEL: Record<SourceKind, string> = {
  owner_input: "Owner input",
  web_scrape: "Web",
  ai_inference: "AI inference",
  customer_inbox: "Customer inbox",
};

export type FactAction = "proposed" | "added" | "edited" | "confirmed" | "rejected" | "removed";

export interface FieldGroup {
  key: string;
  label: string;
  blurb: string | null;
  sort: number;
}

export interface Industry {
  key: string;
  label: string;
  blurb: string | null;
  sort: number;
}

export interface ModuleStatus {
  group_key: string;
  label: string;
  blurb: string | null;
  tier: number;
  sort: number;
  enabled: boolean;
  fields_total: number;
  fields_filled: number;
  required_total: number;
  required_filled: number;
  proposed_facts: number;
  ready: boolean;
}

export interface FactHistory {
  id: string;
  brand_id: string;
  field_key: string;
  fact_id: string | null;
  action: FactAction;
  from_value: string | null;
  to_value: string | null;
  source_kind: SourceKind | null;
  source_id: string | null;
  at: string;
}

export const ACTION_LABEL: Record<FactAction, string> = {
  proposed: "proposed",
  added: "added",
  edited: "edited",
  confirmed: "confirmed",
  rejected: "rejected",
  removed: "removed",
};
