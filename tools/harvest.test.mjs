// Deterministic harvester tests. Run: node tools/harvest.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// transpile the real TypeScript module, no hand-rolled type stripping
import { execFileSync } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "bw-"));
const srcPath = new URL("../supabase/functions/_shared/harvest.ts", import.meta.url).pathname;
execFileSync("node", [
  new URL("../web/node_modules/typescript/lib/tsc.js", import.meta.url).pathname,
  srcPath, "--target", "es2022", "--module", "esnext", "--outDir", dir, "--skipLibCheck",
], { stdio: "inherit" });
const { harvestPage, mergeHarvest } = await import(join(dir, "harvest.js"));

let pass = 0, fail = 0;
const has = (facts, field, match, label) => {
  const hit = facts.find((f) => f.field_key === field && (match instanceof RegExp ? match.test(f.value) : f.value === match));
  if (hit) { pass++; console.log(`  ok   ${label ?? field} = ${JSON.stringify(hit.value).slice(0,70)}  [${hit.rule} ${hit.confidence}]`); }
  else { fail++; console.log(`  FAIL ${label ?? field} expected ${match}`); }
};
const lacks = (facts, field, label) => {
  const hit = facts.find((f) => f.field_key === field);
  if (!hit) { pass++; console.log(`  ok   no ${label ?? field}`); }
  else { fail++; console.log(`  FAIL ${label ?? field} should be absent, got ${hit.value}`); }
};

// ---------------------------------------------------------------- fixture 1
const jsonld = `<!doctype html><html><head>
<meta name="theme-color" content="#0B5FFF">
<meta property="og:site_name" content="Riverside Plumbing">
<meta name="description" content="Emergency plumbers covering Waltham and the western suburbs since 1998.">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"Plumber","name":"Riverside Plumbing & Heating","legalName":"Riverside Plumbing LLC",
  "description":"Licensed plumbing and heating, 24/7 emergency callouts.",
  "telephone":"+1-781-555-0142","email":"help@riversideplumbing.com","priceRange":"$$",
  "foundingDate":"1998-04-02","logo":{"@type":"ImageObject","url":"https://riversideplumbing.com/logo.png"},
  "address":{"@type":"PostalAddress","streetAddress":"14 Mill Road","addressLocality":"Waltham","addressRegion":"MA","postalCode":"02453"},
  "areaServed":[{"@type":"City","name":"Waltham"},{"@type":"City","name":"Newton"}],
  "sameAs":["https://www.facebook.com/riversideplumbing","https://www.instagram.com/riversideplumbing"],
  "openingHoursSpecification":[
    {"@type":"OpeningHoursSpecification","dayOfWeek":["https://schema.org/Monday","https://schema.org/Friday"],"opens":"07:00","closes":"18:00"}],
  "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"212"},
  "founder":{"@type":"Person","name":"Dave Nunes","jobTitle":"Master Plumber"},
  "hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[
    {"@type":"Offer","itemOffered":{"@type":"Service","name":"Boiler installation"}},
    {"@type":"Offer","itemOffered":{"@type":"Service","name":"Drain clearing"}}]}},
 {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Do you charge a callout fee?",
   "acceptedAnswer":{"@type":"Answer","text":"No call-out fee within 10 miles."}}]}]}
</script></head><body>
<a href="tel:+17815550142">781 555 0142</a>
<a href="mailto:help@riversideplumbing.com">Email us</a>
<a href="https://www.facebook.com/riversideplumbing">Facebook</a>
<a href="/book-a-visit">Book a visit</a>
<address>14 Mill Road, Waltham MA 02453</address>
<p>Family-owned and operated. Licensed and insured. Free estimates. Serving Waltham, Newton and Belmont.</p>
</body></html>`;

console.log("\nfixture 1: full JSON-LD plumber");
{
  const { facts, extras } = harvestPage(jsonld, "https://riversideplumbing.com/");
  const m = mergeHarvest(facts);
  has(m, "trading_name", "Riverside Plumbing & Heating");
  has(m, "legal_name", "Riverside Plumbing LLC");
  has(m, "contact_phone", /555.?0142/);
  has(m, "contact_email", "help@riversideplumbing.com");
  has(m, "address", /14 Mill Road/);
  has(m, "founded_year", "1998");
  has(m, "hours", /Mon.*07:00-18:00/);
  has(m, "pricing", "$$");
  has(m, "reviews_summary", /4\.8 out of 5 from 212/);
  has(m, "team", "Dave Nunes, Master Plumber");
  has(m, "services", "Boiler installation");
  has(m, "service_area", /Waltham/);
  has(m, "social_handles", /Facebook/);
  has(m, "faq_items", /callout fee/i);
  has(m, "booking_url", /book-a-visit/);
  has(m, "differentiators", /family-owned/i);
  has(m, "differentiators", /licen[cs]ed and insured/i, "licensed and insured -> differentiators");
  console.log("  extras:", JSON.stringify(extras));
  const socials = m.filter((f) => f.field_key === "social_handles");
  console.log(`  socials deduped: ${socials.length} (facebook appears in sameAs and as a link)`);
  if (socials.length === 2) pass++; else { console.log("  FAIL expected 2 socials, got " + socials.length); fail++; }
}

// ---------------------------------------------------------------- fixture 2
console.log("\nfixture 2: no structured data at all");
{
  const bare = `<!doctype html><html><head><title>Bella Nails</title>
  <meta name="description" content="Nail salon in Watertown. Walk-ins welcome.">
  </head><body>
  <p>Call us on (617) 555-9981 or email hello@bellanails.com</p>
  <p>Mon-Sat: 9am - 7pm</p>
  <p>Established 2011. Locally owned.</p>
  </body></html>`;
  const m = mergeHarvest(harvestPage(bare, "https://bellanails.com/").facts);
  has(m, "one_liner", /Nail salon in Watertown/);
  has(m, "contact_phone", /617.*555.*9981/);
  has(m, "contact_email", "hello@bellanails.com");
  has(m, "hours", /9am - 7pm/i);
  has(m, "founded_year", "2011");
  has(m, "differentiators", /locally.owned/i);
}

// ---------------------------------------------------------------- fixture 3
console.log("\nfixture 3: microdata only");
{
  const md = `<div itemscope itemtype="http://schema.org/LocalBusiness">
    <h1 itemprop="name">Hartley Auto</h1>
    <span itemprop="telephone">508-555-3311</span>
    <span itemprop="priceRange">$$$</span>
    <meta itemprop="foundingDate" content="1974-01-01">
  </div>`;
  const m = mergeHarvest(harvestPage(md, "https://hartleyauto.com/").facts);
  has(m, "trading_name", "Hartley Auto");
  has(m, "contact_phone", /508-555-3311/);
  has(m, "pricing", "$$$");
  has(m, "founded_year", "1974");
}

// ---------------------------------------------------------------- fixture 4
console.log("\nfixture 4: hostile input, must not invent");
{
  const junk = `<html><head><script type="application/ld+json">{ broken json,,, }</script></head>
  <body><p>Lorem ipsum dolor sit amet.</p>
  <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
  <a href="https://twitter.com/intent/tweet">Tweet</a>
  <img src="logo@2x.png"></body></html>`;
  const m = mergeHarvest(harvestPage(junk, "https://example.com/").facts);
  lacks(m, "trading_name");
  lacks(m, "contact_phone");
  lacks(m, "social_handles", "share buttons are not social profiles");
  lacks(m, "contact_email", "logo@2x.png is not an email");
}

// ---------------------------------------------------------------- fixture 5
console.log("\nfixture 5: single-value fields keep the best source only");
{
  const conflict = `<html><head>
  <meta property="og:site_name" content="Weak Name From Meta">
  <script type="application/ld+json">{"@type":"Organization","name":"Strong Name From Schema"}</script>
  </head><body></body></html>`;
  const m = mergeHarvest(harvestPage(conflict, "https://x.com/").facts);
  has(m, "trading_name", "Strong Name From Schema", "jsonld beats meta");
  const names = m.filter((f) => f.field_key === "trading_name");
  if (names.length === 1) { pass++; console.log("  ok   only one trading_name survives"); }
  else { fail++; console.log(`  FAIL ${names.length} trading_name values survived`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
