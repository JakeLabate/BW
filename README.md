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
  src/screens/           one file per tab
supabase/migrations/     schema, RLS, the field checklist, the gap engine
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

`web/.env.production` carries the Supabase URL and publishable key. Both are public by design; the
publishable key only reaches data that row level security already allows.

## Known edges

- Publishing is a queue and a copy out, not an API push. Facebook and LinkedIn posting needs OAuth
  and, on Meta's side, app review.
- The customer inbox is imported by paste or CSV. Live mailbox and DM connections are not wired up.
- Google Business, Yelp, Instagram and LinkedIn block automated readers, so those sources go through
  the paste path rather than the scraper.

Jake Labate, SEO Consultant
