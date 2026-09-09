-- Profile gap loop: every required field with no confirmed fact is an open gap.
create or replace function refresh_profile_gaps(p_brand uuid)
returns table (opened int, resolved int)
language plpgsql security invoker set search_path = public as $$
declare v_opened int := 0; v_resolved int := 0;
begin
  if not owns_brand(p_brand) then
    raise exception 'not your brand';
  end if;

  with fixed as (
    update gaps g set status = 'resolved', resolved_at = now()
    where g.brand_id = p_brand and g.kind = 'profile' and g.status = 'open'
      and exists (select 1 from brand_facts f
                  where f.brand_id = p_brand and f.field_key = g.field_key and f.status = 'confirmed')
    returning 1
  ) select count(*) into v_resolved from fixed;

  with missing as (
    insert into gaps (brand_id, kind, field_key, title, detail, suggestion)
    select p_brand, 'profile', d.key,
           'Missing: ' || d.label,
           coalesce(d.help, 'The brand record has no confirmed value for ' || d.label || '.'),
           'Add ' || d.label || ' so generated content can use it.'
    from field_defs d
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

create or replace view brand_completeness with (security_invoker = true) as
select b.id as brand_id,
       count(*) filter (where d.required) as required_total,
       count(*) filter (where d.required and f.field_key is not null) as required_filled,
       count(*) filter (where f.field_key is not null) as fields_filled,
       count(*) as fields_total
from brands b
cross join field_defs d
left join lateral (
  select distinct bf.field_key from brand_facts bf
  where bf.brand_id = b.id and bf.field_key = d.key and bf.status = 'confirmed'
) f on true
group by b.id;
