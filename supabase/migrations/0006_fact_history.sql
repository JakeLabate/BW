-- Every field carries its own audit trail: what changed, from what to what,
-- when, and which source is responsible. Written by trigger so it cannot be
-- bypassed by the app or by an edge function.
create type fact_action as enum ('proposed','added','edited','confirmed','rejected','removed');

create table fact_history (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  field_key text not null,
  fact_id uuid,
  action fact_action not null,
  from_value text,
  to_value text,
  source_kind source_kind,
  source_id uuid,
  actor uuid,
  at timestamptz not null default now()
);
create index on fact_history (brand_id, field_key, at desc);
create index on fact_history (brand_id, at desc);

create or replace function record_fact_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into fact_history (brand_id, field_key, fact_id, action, from_value, to_value, source_kind, source_id, actor)
    values (new.brand_id, new.field_key, new.id,
            (case when new.status = 'confirmed' then 'added' else 'proposed' end)::fact_action,
            null, new.value, new.source_kind, new.source_id, auth.uid());
    return new;

  elsif tg_op = 'UPDATE' then
    if new.value is distinct from old.value then
      insert into fact_history (brand_id, field_key, fact_id, action, from_value, to_value, source_kind, source_id, actor)
      values (new.brand_id, new.field_key, new.id, 'edited'::fact_action, old.value, new.value, new.source_kind, new.source_id, auth.uid());
    end if;
    if new.status is distinct from old.status then
      insert into fact_history (brand_id, field_key, fact_id, action, from_value, to_value, source_kind, source_id, actor)
      values (new.brand_id, new.field_key, new.id,
              (case new.status when 'confirmed' then 'confirmed' when 'rejected' then 'rejected' else 'proposed' end)::fact_action,
              old.status::text, new.status::text, new.source_kind, new.source_id, auth.uid());
    end if;
    return new;

  else
    insert into fact_history (brand_id, field_key, fact_id, action, from_value, to_value, source_kind, source_id, actor)
    values (old.brand_id, old.field_key, old.id, 'removed'::fact_action, old.value, null, old.source_kind, old.source_id, auth.uid());
    return old;
  end if;
end $$;

create trigger t_facts_history
after insert or update or delete on brand_facts
for each row execute function record_fact_history();

-- history is read only to clients; only the trigger writes it
alter table fact_history enable row level security;
create policy fact_history_select on fact_history
  for select to authenticated using (private.owns_brand(brand_id));

alter table brand_modules enable row level security;
create policy brand_modules_select on brand_modules for select to authenticated using (private.owns_brand(brand_id));
create policy brand_modules_insert on brand_modules for insert to authenticated with check (private.owns_brand(brand_id));
create policy brand_modules_delete on brand_modules for delete to authenticated using (private.owns_brand(brand_id));

alter table field_groups enable row level security;
alter table industries enable row level security;
alter table industry_modules enable row level security;
create policy field_groups_select on field_groups for select to authenticated using (true);
create policy industries_select on industries for select to authenticated using (true);
create policy industry_modules_select on industry_modules for select to authenticated using (true);
