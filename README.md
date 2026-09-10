# BrandWield

Brand intelligence for small businesses, live at **https://brandwield.jakelabate.com**.

The product is one loop:

```
COLLECT  ->  STORE  ->  GENERATE  ->  PUBLISH
  owner input        structured        posts and       set cadence
  web scrape         brand profile     campaigns
  AI inference           |  ^
  customer inbox         |  |
                         v  |
              PROFILE GAP  /  MARKET GAP
        record is missing     customers keep asking for
        something, nudge      something you do not offer,
        the owner             suggest adding or repricing it
```

Two feedback loops are the point of the thing. A **profile gap** is a required field with no
confirmed value behind it, so the app nudges the owner to fill it and the next batch of content gets
better. A **market gap** is repeated demand in the customer inbox for something the business does not
sell; approving one creates an offer, and an offer becomes an announcement.

## The profile is modular, and shaped by the industry

A brand profile is not one flat list of fields. It is assembled from **modules**, and which modules
a business starts with depends on what kind of business it is. A real estate agent gets Listings and
Neighborhoods on day one; an auto dealership gets Inventory instead. Eleven industry presets, 27
modules, 96 fields.

Modules arrive in three tiers: on from day one, the natural next step, and for later. A later module
becomes available once the day one modules are about 70% filled, **or** the moment a collection run
finds something that belongs in it. So the profile grows because the business has outgrown it, not
because a form demanded forty answers up front.

Gaps only ever come from modules that are switched on, which is what keeps a new brand from opening
with an impossible checklist.

## Sources are integrations, not receipts

Each source is a standing connection with its own settings: a name, an on or off switch, how often
it captures, which modules it is allowed to write to, a confidence floor below which values are
discarded, and whether it is trusted enough to skip your review. The customer inbox is one of these
too, rather than a screen of its own.

Scope is the interesting one. Point an integration at three modules and it can only ever write
there, so a scraper that keeps guessing at your voice can be told to stick to contact details.

Schedules are stored intent. Automatic runs are not wired up yet, so anything other than manual
shows as due rather than firing on its own.

## One door per platform, and no OAuth app

`source_providers` is a catalogue of 42 named platforms across six categories: your website, client
communication, social and publishing, reviews and listings, what only you know, and inference. Each
entry states how information actually gets out of that platform, and whether that path is built or
still a paste. Nothing here asks you for a password or an OAuth grant.

There are four working paths.

**Webhook.** Every inbox integration mints a private ingest URL. Anything that can send an HTTP POST
can feed it: a Gmail filter through Zapier, a Slack workflow step, a Power Automate flow, a Twilio
number, an Intercom or Zendesk or Front webhook, or the form on your own site posting straight to
it. `supabase/functions/ingest` reads field names loosely, so `body`, `text`, `message` and
`content` all mean the message and `from`, `sender`, `email` and `name` all mean who sent it. It
unwraps a Slack event envelope, answers Slack's verification handshake, understands form encoded
posts, strips the quoted reply chain off an email, uses any id in the payload to ignore a repeat
delivery, and refuses to store anything whose key looks like a token or a password. The URL is the
only credential, so it is masked in the interface and can be rotated in one click.

**Feed.** A surprising number of platforms still hand you everything for free. `supabase/functions/feed`
reads RSS, Atom and JSON Feed, and knows how to turn a profile URL into the address the platform
actually serves: a YouTube handle becomes the channel's Atom feed, a subreddit gets `.rss`, a
Substack gets `/feed`, a Medium profile becomes `medium.com/feed/@you`. For anything else it reads
the page and follows whatever feed it declares. No key, no model, nothing invented.

**Scrape.** The deterministic harvester below, pointed at your site, a Google Business profile, a
Yelp page or a Trustpilot listing.

**Paste.** The honest fallback. Instagram, LinkedIn, X, TikTok, Threads, G2 and Tripadvisor either
gate their APIs behind app review or block readers outright, so those providers say `paste for now`
on their own card rather than pretending otherwise.

Messages carry a direction. `inbound` is a customer talking, and only inbound messages feed the
market gap loop. `outbound` is the business talking, and those feed voice inference, so connecting a
feed means you never have to paste ten posts into the inference panel again.

## Rules before the model

`supabase/functions/_shared/harvest.ts` fills the profile from a website without calling a model at
all. It reads, in descending order of trust:

1. **JSON-LD**: Organization and LocalBusiness subtypes, plus FAQPage. A business that publishes
   schema.org has already answered the question, so name, legal name, phone, email, address, opening
   hours, price range, area served, founding date, sameAs profiles, offer catalogue, aggregate
   rating, awards and named people all come straight out at 0.85 to 0.95 confidence.
2. **Microdata**: the same vocabulary in attribute form, including void elements where the value
   sits in `content` rather than between tags.
3. **Meta tags**: og:site_name, descriptions, theme-color, og:image.
4. **Link protocols**: `tel:` and `mailto:` are unambiguous by construction, so they score 0.95.
   Social profiles are matched by host, with share and intent URLs excluded.
5. **Text patterns**: a deliberately small set: established year, family or veteran owned, licensed
   and insured, opening hours lines, "serving X, Y and Z", licence numbers. These sit at 0.6 to 0.8
   because they are heuristics, and they are the first thing to distrust.

Every value carries the rule that produced it, so a wrong value is traceable to a rule and the rule
is fixable. Values are ranked by rule trust rather than by which page they came from, single-value
fields keep only the best-sourced answer, and the same profile found in both `sameAs` and a footer
link is deduplicated to one.

The harvester reports what it could not answer, which is the point: a website integration set to
`assisted` runs rules first and then spends model tokens only on the remainder. Set to `rules` it
never calls a model at all and needs no API key.

`tools/harvest.test.mjs` covers the rules against fixtures, including a hostile one that checks the
extractor refuses to invent a business name, a phone number, or an email out of `logo@2x.png`.

## Every field remembers

`fact_history` records each change to every field: added, edited, confirmed, rejected or removed,
with the old value, the new value, the source responsible and the timestamp. It is written by a
database trigger rather than by the app, so nothing can slip past it, and it is read only to
clients. Each field on My Brand expands to show its own trail.

## Ground rules baked into the code

- Nothing collected is treated as true. Every extracted fact lands as `proposed` with its source and
  a supporting quote, and only becomes usable when the owner confirms it.
- Generation reads confirmed facts only. If a claim is not in the record, it cannot appear in a post.
- API keys are encrypted before they reach the database and are never returned to the browser.

## Stack

- **Frontend** React 19 + Vite + TypeScript, static, deployed to GitHub Pages by the workflow in
  `.github/workflows/deploy.yml`. Hash routing, so Pages needs no rewrite rules.
- **Backend** Supabase (project `brandwield`, ref `ucuumfwlnoogrqybbiag`, us-east-1). Postgres with
  row level security on every table, plus five Deno edge functions.
- **Model access** each user supplies their own Anthropic key. The edge functions pick the newest
  Sonnet the key can see at call time rather than pinning a model string.

## Layout

```
web/                     the app
  src/lib/               supabase client, store, shared UI
  src/screens/           one file per left-nav section
supabase/migrations/     schema, RLS, modules and presets, field history, the engines
supabase/functions/      keys, collect, infer, mine, generate
```

## Edge functions

| function   | what it does |
|------------|--------------|
| `keys`     | stores, checks and deletes the caller's Anthropic key, encrypted with AES-GCM |
| `collect`  | reads a site and its useful internal pages, or pasted text, and proposes facts |
| `infer`    | reads the logo image and past post history, infers palette and writing voice |
| `mine`     | reads the customer inbox and reports market gaps with evidence |
| `generate` | writes posts grounded in confirmed facts, optionally announcing a new offer |

Encryption uses a key derived by HKDF from `BW_KEY_SECRET` when that secret is set, and from the
service role key otherwise. Set `BW_KEY_SECRET` before going wide, and re-save stored keys if the
service role key is ever rotated.

## Local development

```bash
cd web
npm install
npm run dev
```

There is deliberately no committed lockfile. Vite and TypeScript both ship per-platform native
binaries as optional dependencies, and npm only records the variants for whichever machine generated
the lock, so a committed lockfile makes the repo installable on one architecture and broken on every
other. CI runs `npm install` instead of `npm ci`.

`web/.env.production` carries the Supabase URL and publishable key. Both are public by design; the
publishable key only reaches data that row level security already allows.

## Known edges

- Publishing is a queue and a copy out, not an API push. Facebook and LinkedIn posting needs OAuth
  and, on Meta's side, app review.
- The customer inbox is imported by paste or CSV. Live mailbox and DM connections are not wired up.
- Google Business, Yelp, Instagram and LinkedIn block automated readers, so those sources go through
  the paste path rather than the scraper.

Jake Labate, SEO Consultant
