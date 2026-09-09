-- Gaps only ever come from modules the brand has actually turned on, so the
-- profile never opens with fifty demands.
create or replace function public.refresh_profile_gaps(p_brand uuid)
returns table (opened int, resolved int)
language plpgsql security invoker set search_path = public, private as $$
declare v_opened int := 0; v_resolved int := 0;
begin
  if not private.owns_brand(p_brand) then raise exception 'not your brand'; end if;

  with fixed as (
    update gaps g set status = 'resolved', resolved_at = now()
    where g.brand_id = p_brand and g.kind = 'profile' and g.status = 'open'
      and (
        exists (select 1 from brand_facts f
                where f.brand_id = p_brand and f.field_key = g.field_key and f.status = 'confirmed')
        or not exists (select 1 from field_defs d
                       join brand_modules bm on bm.group_key = d.group_key and bm.brand_id = p_brand
                       where d.key = g.field_key)
      )
    returning 1
  ) select count(*) into v_resolved from fixed;

  with missing as (
    insert into gaps (brand_id, kind, field_key, title, detail, suggestion)
    select p_brand, 'profile', d.key,
           'Missing: ' || d.label,
           coalesce(d.help, 'The brand record has no confirmed value for ' || d.label || '.'),
           'Add ' || d.label || ' so generated content can use it.'
    from field_defs d
    join brand_modules bm on bm.group_key = d.group_key and bm.brand_id = p_brand
    where d.required
      and not exists (select 1 from brand_facts f
                      where f.brand_id = p_brand and f.field_key = d.key and f.status = 'confirmed')
      and not exists (select 1 from gaps g
                      where g.brand_id = p_brand and g.kind = 'profile' and g.field_key = d.key
                        and g.status in ('open','snoozed'))
    returning 1
  ) select count(*) into v_opened from missing;

  return query select v_opened, v_resolved;
end $$;

-- Create a brand against an industry preset and switch on its day one modules.
create or replace function public.create_brand(p_name text, p_website text, p_industry text)
returns uuid
language plpgsql security invoker set search_path = public, private as $$
declare v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'a brand needs a name'; end if;

  insert into brands (owner_id, name, website_url, industry_key)
  values (auth.uid(), trim(p_name), nullif(trim(coalesce(p_website,'')), ''), p_industry)
  returning id into v_id;

  insert into brand_modules (brand_id, group_key)
  select v_id, im.group_key from industry_modules im
  where im.industry_key = p_industry and im.tier = 0
  on conflict do nothing;

  perform refresh_profile_gaps(v_id);
  return v_id;
end $$;

-- Turn a module on or off, keeping gaps honest either way.
create or replace function public.set_module(p_brand uuid, p_group text, p_on boolean)
returns void
language plpgsql security invoker set search_path = public, private as $$
begin
  if not private.owns_brand(p_brand) then raise exception 'not your brand'; end if;
  if p_on then
    insert into brand_modules (brand_id, group_key) values (p_brand, p_group) on conflict do nothing;
  else
    delete from brand_modules where brand_id = p_brand and group_key = p_group;
  end if;
  perform refresh_profile_gaps(p_brand);
end $$;

-- One row per module available to a brand, with enough to drive the whole
-- "grow your profile" panel without the client doing arithmetic. A module is
-- ready to suggest once the day one modules are 70% filled, or as soon as
-- something already collected belongs in it.
create or replace function public.brand_module_status(p_brand uuid)
returns table (
  group_key text, label text, blurb text, tier smallint, sort int,
  enabled boolean, fields_total int, fields_filled int,
  required_total int, required_filled int, proposed_facts int, ready boolean
)
language plpgsql security invoker set search_path = public, private as $$
declare v_core_pct numeric;
begin
  if not private.owns_brand(p_brand) then raise exception 'not your brand'; end if;

  select case when count(*) filter (where d.required) = 0 then 1
              else count(*) filter (where d.required and c.hit is not null)::numeric
                   / count(*) filter (where d.required)
         end
    into v_core_pct
  from brands b
  join industry_modules im on im.industry_key = b.industry_key and im.tier = 0
  join field_defs d on d.group_key = im.group_key
  left join lateral (
    select 1 as hit from brand_facts f
    where f.brand_id = p_brand and f.field_key = d.key and f.status = 'confirmed' limit 1
  ) c on true
  where b.id = p_brand;

  return query
  select g.key, g.label, g.blurb, im.tier, im.sort,
         bm.brand_id is not null,
         count(d.key)::int,
         count(cf.hit)::int,
         count(d.key) filter (where d.required)::int,
         count(cf.hit) filter (where d.required)::int,
         coalesce(sum(pf.n), 0)::int,
         (im.tier = 0 or coalesce(v_core_pct, 0) >= 0.7 or coalesce(sum(pf.n), 0) > 0)
  from brands b
  join industry_modules im on im.industry_key = b.industry_key
  join field_groups g on g.key = im.group_key
  join field_defs d on d.group_key = g.key
  left join brand_modules bm on bm.brand_id = p_brand and bm.group_key = g.key
  left join lateral (
    select 1 as hit where exists (
      select 1 from brand_facts f
      where f.brand_id = p_brand and f.field_key = d.key and f.status = 'confirmed')
  ) cf on true
  left join lateral (
    select count(*) as n from brand_facts f
    where f.brand_id = p_brand and f.field_key = d.key and f.status = 'proposed'
  ) pf on true
  where b.id = p_brand
  group by g.key, g.label, g.blurb, im.tier, im.sort, bm.brand_id
  order by im.tier, im.sort;
end $$;

-- The fields worth offering a collector for this brand: everything its
-- industry can hold, whether or not the module is switched on yet. A value
-- found for a module the owner has not added becomes the reason to add it.
create or replace function public.industry_fields(p_brand uuid)
returns table (
  key text, label text, help text, required boolean, multi boolean,
  group_key text, group_label text, enabled boolean, sort int
)
language sql security invoker set search_path = public, private as $$
  select d.key, d.label, d.help, d.required, d.multi,
         g.key, g.label, bm.brand_id is not null, d.sort
  from brands b
  join industry_modules im on im.industry_key = b.industry_key
  join field_groups g on g.key = im.group_key
  join field_defs d on d.group_key = g.key
  left join brand_modules bm on bm.brand_id = b.id and bm.group_key = g.key
  where b.id = p_brand and private.owns_brand(p_brand)
  order by im.tier, im.sort, d.sort;
$$;

revoke execute on function public.refresh_profile_gaps(uuid) from anon, public;
revoke execute on function public.create_brand(text, text, text) from anon, public;
revoke execute on function public.set_module(uuid, text, boolean) from anon, public;
revoke execute on function public.brand_module_status(uuid) from anon, public;
revoke execute on function public.industry_fields(uuid) from anon, public;

grant execute on function public.refresh_profile_gaps(uuid) to authenticated;
grant execute on function public.create_brand(text, text, text) to authenticated;
grant execute on function public.set_module(uuid, text, boolean) to authenticated;
grant execute on function public.brand_module_status(uuid) to authenticated;
grant execute on function public.industry_fields(uuid) to authenticated;
