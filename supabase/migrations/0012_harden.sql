-- Two advisor findings, both about functions the API should never see.

-- next_due is pure arithmetic, but an unpinned search_path is still a foothold.
create or replace function public.next_due(p_schedule text, p_from timestamptz default now())
returns timestamptz language sql immutable set search_path = public as $$
  select case p_schedule
    when 'daily'   then p_from + interval '1 day'
    when 'weekly'  then p_from + interval '7 days'
    when 'monthly' then p_from + interval '1 month'
    else null
  end;
$$;

-- record_fact_history is a trigger function, so nothing should be able to reach
-- it over PostgREST. Revoking EXECUTE would work, but moving it out of the
-- exposed schema cannot be undone by a later stray grant. The trigger keeps
-- working because it is bound to the function by OID, the same reasoning that
-- moved owns_brand in 0004b.
create schema if not exists private;

create or replace function private.record_fact_history() returns trigger
language plpgsql security definer set search_path = public, private as $$
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

drop trigger if exists t_facts_history on brand_facts;
create trigger t_facts_history
after insert or update or delete on brand_facts
for each row execute function private.record_fact_history();

drop function if exists public.record_fact_history();
