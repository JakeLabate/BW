-- Integrations are named platforms, not four generic buckets. A provider is a
-- catalogue entry: what the platform is, which way information actually gets
-- out of it today, and whether that way is built or still a paste.

create table source_providers (
  key         text primary key,
  label       text not null,
  kind        source_kind not null,
  category    text not null,          -- inbox | social | reviews | web | owner | ai
  blurb       text not null,
  ingest      text not null,          -- webhook | feed | scrape | paste | upload
  live        boolean not null default true,
  setup       text,                   -- what the owner has to do, in one paragraph
  url_hint    text,                   -- placeholder for the url field, when it has one
  doc_url     text,
  sort        int not null default 100
);

comment on table source_providers is 'Catalogue of platforms an integration can be created from. Global, read only to clients.';
comment on column source_providers.ingest is 'How information actually arrives: webhook (the platform posts to us), feed (we read RSS/Atom/JSON), scrape (we read public pages with rules), paste (the owner pastes), upload (the owner uploads a file).';
comment on column source_providers.live is 'False means the native path is not built yet and the integration falls back to pasting. Say so in the UI rather than pretending.';

alter table source_providers enable row level security;
create policy "providers readable" on source_providers for select to authenticated using (true);

-- A source now points at a provider, and webhook sources carry their own secret.
alter table sources
  add column provider text references source_providers(key),
  add column ingest_token text;

create unique index sources_ingest_token on sources (ingest_token) where ingest_token is not null;
comment on column sources.ingest_token is 'Per integration secret in the inbound webhook URL. The ingest function authenticates on this alone, so it is a credential.';

-- Only inference stays one per brand. A business can have Gmail and Slack and
-- a contact form all at once, and three web scrapes on three sites.
drop index if exists sources_one_inbox_per_brand;
create unique index sources_one_provider_per_brand
  on sources (brand_id, provider, coalesce(url, ''))
  where provider is not null;

-- Messages gain provenance and a direction, because a customer question and a
-- post the brand published are not the same kind of evidence.
alter table messages
  add column provider text,
  add column direction text not null default 'inbound',
  add column external_id text,
  add column permalink text,
  add column author_handle text,
  add column meta jsonb not null default '{}'::jsonb;

comment on column messages.direction is 'inbound = someone said this to the business, feeds the market gap loop. outbound = the business published it, feeds voice inference.';
create unique index messages_external_id on messages (source_id, external_id) where external_id is not null;
create index messages_direction on messages (brand_id, direction, received_at desc);

-- A fresh secret for one integration. Returns the new token to the owner once.
create or replace function public.rotate_ingest_token(p_source uuid)
returns text
language plpgsql security invoker set search_path = public, private as $$
declare v_token text;
begin
  -- pgcrypto lives in the extensions schema on Supabase and this function pins
  -- search_path to public on purpose. gen_random_uuid is core, so two of them
  -- make a 64 character hex token without reaching for an extension.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update sources s set ingest_token = v_token
  where s.id = p_source and private.owns_brand(s.brand_id);
  if not found then raise exception 'not your integration'; end if;
  return v_token;
end $$;

revoke execute on function public.rotate_ingest_token(uuid) from anon, public;
grant execute on function public.rotate_ingest_token(uuid) to authenticated;

-- Every webhook integration gets a token the moment it is created.
create or replace function mint_ingest_token() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.ingest_token is null
     and exists (select 1 from source_providers p where p.key = new.provider and p.ingest = 'webhook')
  then
    new.ingest_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end $$;

create trigger t_sources_mint_token before insert on sources
for each row execute function mint_ingest_token();

-- ------------------------------------------------------------ the catalogue

insert into source_providers (key, label, kind, category, blurb, ingest, live, setup, url_hint, sort) values
-- client communication ------------------------------------------------------
('gmail','Gmail','customer_inbox','inbox','Customer email. Every question a customer ever asked, which is where market gaps come from.','webhook',true,'Forward the mail you want read to the ingest URL using a Gmail filter and a Zapier, Make or Apps Script step that POSTs the message as JSON. Nothing is read from your mailbox that you do not send.',null,10),
('outlook','Outlook and Microsoft 365','customer_inbox','inbox','The same, for a Microsoft mailbox.','webhook',true,'Build a Power Automate flow on new mail arrival and POST the message to the ingest URL.',null,11),
('email_any','Any other mailbox','customer_inbox','inbox','IMAP, Zoho, Fastmail, a shared support address.','webhook',true,'Point any automation that can send an HTTP POST at the ingest URL.',null,12),
('slack','Slack','customer_inbox','inbox','Channels where clients talk to you, or a shared channel with a customer.','webhook',true,'Slack Workflow Builder: add a Send a webhook step to a message trigger and paste the ingest URL. No Slack app or scopes needed.',null,13),
('teams','Microsoft Teams','customer_inbox','inbox','Client chats and channel posts in Teams.','webhook',true,'Power Automate has a Teams trigger and an HTTP action. Point the HTTP action at the ingest URL.',null,14),
('discord','Discord','customer_inbox','inbox','Community servers where customers ask before they buy.','webhook',true,'Any Discord bot or automation that can POST JSON works. Send the message text and author.',null,15),
('intercom','Intercom','customer_inbox','inbox','Live chat conversations.','webhook',true,'Intercom webhooks: subscribe to conversation events and set the ingest URL as the endpoint.',null,16),
('front','Front','customer_inbox','inbox','Shared inbox conversations.','webhook',true,'Front rules can call a webhook. Point it at the ingest URL.',null,17),
('zendesk','Zendesk','customer_inbox','inbox','Support tickets.','webhook',true,'Zendesk trigger with a Notify active webhook action, targeting the ingest URL.',null,18),
('helpscout','Help Scout','customer_inbox','inbox','Support conversations.','webhook',true,'Help Scout apps and webhooks both post JSON. Use the ingest URL as the callback.',null,19),
('crisp','Crisp','customer_inbox','inbox','Website live chat.','webhook',true,'Crisp web hooks, message:send event, ingest URL as the target.',null,20),
('hubspot','HubSpot','customer_inbox','inbox','Form submissions and conversation inbox.','webhook',true,'HubSpot workflows have a webhook action. Send the contact message to the ingest URL.',null,21),
('twilio_sms','SMS by Twilio','customer_inbox','inbox','Texts from customers.','webhook',true,'Set the ingest URL as the messaging webhook on your Twilio number. Form encoded posts are understood.',null,22),
('whatsapp','WhatsApp Business','customer_inbox','inbox','WhatsApp messages from customers.','webhook',true,'Route WhatsApp Cloud API messages through your own handler or an automation tool and POST them to the ingest URL.',null,23),
('contact_form','Website contact form','customer_inbox','inbox','The form on your own site. The single highest signal source there is.','webhook',true,'Most form tools post to a URL on submit. Paste the ingest URL there. Webflow, Framer, Netlify, Formspree and plain HTML posts all work.',null,24),
('typeform','Typeform','customer_inbox','inbox','Enquiry and qualification forms.','webhook',true,'Typeform Connect, webhooks, ingest URL as the endpoint.',null,25),
('calendly','Calendly','customer_inbox','inbox','What people write when they book.','webhook',true,'Calendly webhook subscription on invitee.created.',null,26),
('phone_notes','Phone call notes','customer_inbox','inbox','What people ask on the phone, in your own words.','paste',true,'Paste them. One call per block.',null,27),
-- social --------------------------------------------------------------------
('youtube','YouTube','web_scrape','social','Your channel. Titles and descriptions are your own voice, at length.','feed',true,'Paste your channel URL. YouTube publishes an Atom feed for every channel and no key is needed.','youtube.com/@yourchannel',40),
('reddit','Reddit','web_scrape','social','A subreddit or your own posts. Good for what people ask before they buy.','feed',true,'Paste a subreddit or user URL. Reddit serves RSS on any listing.','reddit.com/r/yourtown',41),
('mastodon','Mastodon','web_scrape','social','Your posts on any Mastodon server.','feed',true,'Paste your profile URL. Every Mastodon profile has an RSS feed.','mastodon.social/@you',42),
('bluesky','Bluesky','web_scrape','social','Your Bluesky posts.','feed',true,'Paste your profile URL.','bsky.app/profile/you.bsky.social',43),
('substack','Substack','web_scrape','social','Your newsletter, which is usually the truest sample of how you write.','feed',true,'Paste the publication URL.','you.substack.com',44),
('medium','Medium','web_scrape','social','Articles you have published.','feed',true,'Paste your Medium profile or publication URL.','medium.com/@you',45),
('blog_rss','Blog or newsletter feed','web_scrape','social','Any site that publishes RSS, Atom or JSON Feed. Most do, quietly.','feed',true,'Paste the site URL and the feed is discovered from the page, or paste the feed URL directly.','example.com/blog',46),
('podcast','Podcast','web_scrape','social','Episode titles and show notes.','feed',true,'Paste the RSS feed URL from your host.','feeds.example.com/show.xml',47),
('instagram','Instagram','web_scrape','social','Posts and DMs. Meta gates both behind app review, so this is a paste for now.','paste',false,'Paste captions from recent posts, or DMs, one per block. When the Meta app review lands this becomes native.','instagram.com/you',48),
('facebook_page','Facebook Page','web_scrape','social','Page posts, reviews and Messenger.','paste',false,'Paste posts or reviews for now. Messenger can already arrive natively through a contact form or automation webhook.','facebook.com/yourpage',49),
('linkedin_page','LinkedIn','web_scrape','social','Company page or personal posts.','paste',false,'LinkedIn has no public feed and its API is closed to most apps. Paste posts, one per block.','linkedin.com/company/you',50),
('x_twitter','X','web_scrape','social','Your posts and replies.','paste',false,'X removed free API access and public RSS. Paste posts for now.','x.com/you',51),
('tiktok','TikTok','web_scrape','social','Captions from your videos.','paste',false,'Paste captions, one per block.','tiktok.com/@you',52),
('threads','Threads','web_scrape','social','Threads posts.','paste',false,'Paste posts, one per block.','threads.net/@you',53),
('pinterest','Pinterest','web_scrape','social','Board and pin descriptions.','feed',true,'Paste your profile URL. Pinterest serves RSS on profiles and boards.','pinterest.com/you',54),
-- reviews -------------------------------------------------------------------
('google_business','Google Business Profile','web_scrape','reviews','Hours, categories, attributes and what reviewers actually say.','scrape',true,'Paste your Maps or business profile URL and the rules read whatever the page exposes. Anything blocked can be pasted.','g.page/yourbusiness',60),
('yelp','Yelp','web_scrape','reviews','Categories, price band, hours and review themes.','scrape',true,'Paste your Yelp page URL. Yelp blocks readers sometimes, in which case paste the page text.','yelp.com/biz/you',61),
('trustpilot','Trustpilot','web_scrape','reviews','Rating, volume and recurring complaints.','scrape',true,'Paste your Trustpilot page URL.','trustpilot.com/review/you.com',62),
('g2','G2','web_scrape','reviews','Software review themes.','paste',false,'G2 blocks automated readers. Paste the review text.','g2.com/products/you',63),
('tripadvisor','Tripadvisor','web_scrape','reviews','Traveller reviews.','paste',false,'Tripadvisor blocks automated readers. Paste the review text.','tripadvisor.com/...',64),
-- web and owner -------------------------------------------------------------
('website','Website','web_scrape','web','Your own site. Rules read schema.org, meta tags and link protocols with no model and no key.','scrape',true,'Paste the URL. It reads the home page and the pages most likely to hold facts.','example.com',1),
('page_paste','Pasted page','owner_input','owner','Any page or document you can copy, including ones that block readers.','paste',true,'Paste the text.',null,70),
('owner_notes','Your own notes','owner_input','owner','What you know that is written down nowhere.','paste',true,'Type or paste it.',null,71),
('ai_inference','Logo and post history','ai_inference','ai','Claude reads the logo file and past posts and infers palette and writing voice.','upload',true,'Upload the logo and paste ten posts.',null,80);

-- Existing rows predate the catalogue. Give them the closest provider.
update sources set provider = 'website'      where provider is null and kind = 'web_scrape';
update sources set provider = 'page_paste'   where provider is null and kind = 'owner_input';
update sources set provider = 'ai_inference' where provider is null and kind = 'ai_inference';
update sources set provider = 'email_any'    where provider is null and kind = 'customer_inbox';

update sources s set ingest_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where s.ingest_token is null
  and exists (select 1 from source_providers p where p.key = s.provider and p.ingest = 'webhook');
