-- A source is not a receipt for one run. It is a standing integration with
-- its own settings: what it captures, how often, and how much it is trusted.
alter table sources
  add column name text,
  add column status text not null default 'active',
  add column schedule text not null default 'manual',
  add column scope jsonb not null default '[]'::jsonb,
  add column min_confidence numeric(3,2) not null default 0,
  add column auto_confirm boolean not null default false,
  add column next_run_at timestamptz,
  add column run_count int not null default 0;

comment on column sources.scope is 'Array of field_group keys this integration may write to. Empty array means every module the industry allows.';
comment on column sources.schedule is 'manual | daily | weekly | monthly. Stored intent; automatic runs are not wired up yet.';
comment on column sources.min_confidence is 'Values the model returns below this confidence are discarded rather than proposed.';
comment on column sources.auto_confirm is 'When true, values at or above min_confidence land confirmed instead of waiting for review.';

update sources set name = label where name is null;
alter table sources alter column name set not null;

-- the inbox and the inference integration are one per brand
create unique index sources_one_inbox_per_brand on sources (brand_id) where kind = 'customer_inbox';
create unique index sources_one_inference_per_brand on sources (brand_id) where kind = 'ai_inference';

create or replace function public.next_due(p_schedule text, p_from timestamptz default now())
returns timestamptz language sql immutable as $$
  select case p_schedule
    when 'daily'   then p_from + interval '1 day'
    when 'weekly'  then p_from + interval '7 days'
    when 'monthly' then p_from + interval '1 month'
    else null
  end;
$$;

-- Count a run against an integration and work out when it is next due.
create or replace function public.bump_integration(p_source uuid)
returns void
language plpgsql security invoker set search_path = public, private as $$
begin
  update sources s
  set run_count = s.run_count + 1,
      last_run_at = now(),
      next_run_at = next_due(s.schedule, now())
  where s.id = p_source and private.owns_brand(s.brand_id);
end $$;

revoke execute on function public.bump_integration(uuid) from anon, public;
grant execute on function public.bump_integration(uuid) to authenticated;

-- Keep next_run_at honest whenever the schedule or status changes.
create or replace function sync_next_run() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.schedule is distinct from old.schedule or new.status is distinct from old.status then
    new.next_run_at := case when new.status = 'active'
                            then next_due(new.schedule, coalesce(new.last_run_at, now()))
                            else null end;
  end if;
  return new;
end $$;

create trigger t_sources_next_run before update on sources
for each row execute function sync_next_run();

-- Existing rows were one per run. Collapse them into one integration per
-- brand, kind and url, keeping the facts pointed at the survivor.
with ranked as (
  select id, brand_id, kind, url,
         row_number() over (partition by brand_id, kind, coalesce(url,'') order by created_at) as rn,
         first_value(id) over (partition by brand_id, kind, coalesce(url,'') order by created_at) as keep_id
  from sources
)
update brand_facts f set source_id = r.keep_id
from ranked r where f.source_id = r.id and r.rn > 1;

delete from sources s using (
  select id, row_number() over (partition by brand_id, kind, coalesce(url,'') order by created_at) as rn
  from sources
) r where s.id = r.id and r.rn > 1;
