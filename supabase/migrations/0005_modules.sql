-- A brand profile is assembled from modules, and which modules a business
-- starts with depends on what kind of business it is.
create table field_groups (
  key text primary key,
  label text not null,
  blurb text,
  sort int not null default 0
);

create table industries (
  key text primary key,
  label text not null,
  blurb text,
  sort int not null default 0
);

-- tier 0 = on from day one, 1 = the natural next step, 2 = for later
create table industry_modules (
  industry_key text not null references industries(key) on delete cascade,
  group_key text not null references field_groups(key) on delete cascade,
  tier smallint not null default 1,
  sort int not null default 0,
  primary key (industry_key, group_key)
);

create table brand_modules (
  brand_id uuid not null references brands(id) on delete cascade,
  group_key text not null references field_groups(key) on delete cascade,
  enabled_at timestamptz not null default now(),
  primary key (brand_id, group_key)
);

alter table brands add column industry_key text references industries(key);
alter table field_defs add column group_key text references field_groups(key);
