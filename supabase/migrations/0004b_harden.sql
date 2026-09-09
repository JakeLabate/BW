-- Keep the RLS helper out of the API-exposed schema so PostgREST cannot call
-- it as an endpoint, while policies (which reference it by oid) keep working.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;
alter function public.owns_brand(uuid) set schema private;
grant execute on function private.owns_brand(uuid) to authenticated, service_role;
revoke execute on function private.owns_brand(uuid) from anon, public;

create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
