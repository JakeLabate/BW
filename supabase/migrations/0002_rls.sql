create or replace function owns_brand(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from brands where id = b and owner_id = auth.uid());
$$;

alter table brands           enable row level security;
alter table sources          enable row level security;
alter table brand_facts      enable row level security;
alter table messages         enable row level security;
alter table gaps             enable row level security;
alter table offers           enable row level security;
alter table campaigns        enable row level security;
alter table content_items    enable row level security;
alter table schedules        enable row level security;
alter table runs             enable row level security;
alter table provider_keys    enable row level security;
alter table field_defs       enable row level security;

create policy brands_select on brands for select to authenticated using (owner_id = auth.uid());
create policy brands_insert on brands for insert to authenticated with check (owner_id = auth.uid());
create policy brands_update on brands for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy brands_delete on brands for delete to authenticated using (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['sources','brand_facts','messages','gaps','offers','campaigns','content_items','schedules','runs']
  loop
    execute format('create policy %1$s_select on %1$s for select to authenticated using (owns_brand(brand_id));', t);
    execute format('create policy %1$s_insert on %1$s for insert to authenticated with check (owns_brand(brand_id));', t);
    execute format('create policy %1$s_update on %1$s for update to authenticated using (owns_brand(brand_id)) with check (owns_brand(brand_id));', t);
    execute format('create policy %1$s_delete on %1$s for delete to authenticated using (owns_brand(brand_id));', t);
  end loop;
end $$;

create policy field_defs_select on field_defs for select to authenticated using (true);

-- provider_keys deliberately has no client policies: only the service role
-- inside the edge functions can read or write ciphertext.
