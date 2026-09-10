-- Rules first, model second. A website integration can run purely on rules
-- (no API key, no tokens), rules then a model pass for what rules missed, or
-- the model alone.
alter table sources
  add column extract_mode text not null default 'assisted';

comment on column sources.extract_mode is 'rules | assisted | ai. rules uses the deterministic harvester only; assisted runs the harvester then asks the model for whatever is still empty; ai skips the harvester.';

update sources set extract_mode = 'assisted' where kind = 'web_scrape';
update sources set extract_mode = 'ai' where kind in ('owner_input', 'ai_inference');
