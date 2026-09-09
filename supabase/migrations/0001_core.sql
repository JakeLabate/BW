-- BrandWield core schema
-- Loop: collect -> store -> (profile gap / market gap) -> generate -> publish

create extension if not exists pgcrypto;

create type source_kind as enum ('owner_input','web_scrape','ai_inference','customer_inbox');
create type run_status as enum ('queued','running','done','failed');
create type fact_status as enum ('proposed','confirmed','rejected');
create type gap_kind as enum ('profile','market');
create type gap_status as enum ('open','snoozed','dismissed','resolved');
create type offer_status as enum ('proposed','approved','rejected','live');
create type content_status as enum ('draft','approved','queued','published','archived');
create type platform as enum ('facebook','linkedin','instagram','x','email','blog');

create table brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  website_url text,
  industry text,
  one_liner text,
  logo_url text,
  primary_color text,
  locations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on brands (owner_id);

-- the checklist that defines a complete profile; profile gaps are required
-- defs with no confirmed fact behind them
create table field_defs (
  key text primary key,
  category text not null,
  label text not null,
  help text,
  required boolean not null default false,
  multi boolean not null default false,
  sort int not null default 0
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  kind source_kind not null,
  label text not null,
  url text,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index on sources (brand_id);

create table brand_facts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  field_key text not null references field_defs(key) on delete cascade,
  value text not null,
  status fact_status not null default 'proposed',
  confidence numeric(3,2),
  source_id uuid references sources(id) on delete set null,
  source_kind source_kind not null default 'owner_input',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on brand_facts (brand_id, field_key);
create index on brand_facts (brand_id, status);

create table messages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  source_id uuid references sources(id) on delete set null,
  channel text not null default 'manual',
  sender text,
  subject text,
  body text not null,
  received_at timestamptz not null default now(),
  intent text,
  created_at timestamptz not null default now()
);
create index on messages (brand_id, received_at desc);

create table gaps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  kind gap_kind not null,
  field_key text references field_defs(key) on delete set null,
  title text not null,
  detail text,
  suggestion text,
  demand_count int not null default 0,
  evidence jsonb not null default '[]'::jsonb,
  status gap_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on gaps (brand_id, status, kind);

create table offers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  gap_id uuid references gaps(id) on delete set null,
  name text not null,
  description text,
  price text,
  status offer_status not null default 'proposed',
  announced boolean not null default false,
  created_at timestamptz not null default now()
);
create index on offers (brand_id, status);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  name text not null,
  objective text,
  offer_id uuid references offers(id) on delete set null,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);
create index on campaigns (brand_id);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  platform platform not null default 'linkedin',
  title text,
  body text not null,
  hashtags text,
  status content_status not null default 'draft',
  scheduled_for timestamptz,
  published_at timestamptz,
  grounded_in jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on content_items (brand_id, status, scheduled_for);

create table schedules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  platform platform not null,
  days_of_week int[] not null default '{2,4}',
  time_of_day time not null default '09:00',
  timezone text not null default 'America/New_York',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, platform)
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  kind text not null,
  status run_status not null default 'queued',
  detail jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on runs (brand_id, started_at desc);

-- provider keys are written and read only by the edge functions
create table provider_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'anthropic',
  ciphertext text not null,
  iv text not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger t_brands_touch before update on brands for each row execute function touch_updated_at();
create trigger t_facts_touch before update on brand_facts for each row execute function touch_updated_at();
create trigger t_content_touch before update on content_items for each row execute function touch_updated_at();
create trigger t_keys_touch before update on provider_keys for each row execute function touch_updated_at();
