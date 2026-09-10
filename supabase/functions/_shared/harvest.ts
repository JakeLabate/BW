/**
 * Deterministic extraction. No model, no API key, no guessing.
 *
 * Everything in here is a rule that either matches or does not. Structured
 * markup first, because a business that publishes schema.org has already told
 * us the answer; then meta tags; then link protocols, which are unambiguous by
 * definition; then a small set of text patterns that are conservative enough
 * to be worth the risk. Every value carries the rule that produced it, so a
 * wrong one can be traced to a rule and the rule fixed.
 */

export type Harvested = {
  field_key: string;
  value: string;
  confidence: number;
  rule: string;
  quote?: string;
  page?: string;
};

export type HarvestExtras = {
  logo_url?: string;
  theme_color?: string;
};

const MAX_PER_FIELD = 12;

/* ------------------------------------------------------------------ util */

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .trim();

const clean = (s: unknown, max = 400): string => {
  if (typeof s === "number") return String(s).slice(0, max);
  return typeof s === "string" ? decode(s).replace(/\s+/g, " ").slice(0, max) : "";
};

const arr = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

/** schema.org types that describe the business itself. */
const ORG_TYPES =
  /^(Organization|Corporation|LocalBusiness|ProfessionalService|Store|Restaurant|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|GeneralContractor|MovingCompany|HousePainter|Locksmith|RealEstateAgent|AutoDealer|AutoRepair|AutomotiveBusiness|MedicalBusiness|Dentist|Physician|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|NailSalon|SportsActivityLocation|ExerciseGym|HealthClub|LegalService|Attorney|AccountingService|FinancialService|InsuranceAgency|TravelAgency|ChildCare|School|EducationalOrganization|NGO|Person)$/i;

/* -------------------------------------------------------------- JSON-LD */

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
    try {
      out.push(JSON.parse(raw));
    } catch {
      // A trailing comma or a stray newline should not cost us the whole block.
      try {
        out.push(JSON.parse(raw.replace(/,\s*([}\]])/g, "$1")));
      } catch {
        // give up on this block only
      }
    }
  }
  return out;
}

/** Flatten @graph, arrays and nested nodes into one list of typed objects. */
function flattenNodes(input: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || input == null) return [];
  if (Array.isArray(input)) return input.flatMap((v) => flattenNodes(v, depth + 1));
  if (typeof input !== "object") return [];
  const node = input as Record<string, unknown>;
  const out = [node];
  for (const key of ["@graph", "mainEntity", "itemListElement", "about", "publisher", "provider", "author"]) {
    if (node[key]) out.push(...flattenNodes(node[key], depth + 1));
  }
  return out;
}

const typesOf = (n: Record<string, unknown>) =>
  arr(n["@type"] as string | string[]).map((t) => String(t).split("/").pop() ?? "");

function fromJsonLd(html: string, page: string): { facts: Harvested[]; extras: HarvestExtras } {
  const facts: Harvested[] = [];
  const extras: HarvestExtras = {};
  const nodes = jsonLdBlocks(html).flatMap((b) => flattenNodes(b));

  const push = (field_key: string, value: string, confidence: number, rule: string, quote?: string) => {
    if (value) facts.push({ field_key, value, confidence, rule, quote, page });
  };

  for (const n of nodes) {
    const types = typesOf(n);
    const isOrg = types.some((t) => ORG_TYPES.test(t));
    const at = (k: string) => n[k];

    if (isOrg) {
      const t = types[0] ?? "Organization";
      push("trading_name", clean(at("name")), 0.95, `jsonld:${t}.name`);
      push("legal_name", clean(at("legalName")), 0.95, `jsonld:${t}.legalName`);
      push("one_liner", clean(at("slogan")) || clean(at("description")), 0.85, `jsonld:${t}.description`);
      push("mission", clean(at("mission")), 0.8, `jsonld:${t}.mission`);
      push("pricing", clean(at("priceRange")), 0.85, `jsonld:${t}.priceRange`);

      for (const p of arr(at("telephone") as string | string[])) {
        push("contact_phone", clean(p, 40), 0.95, `jsonld:${t}.telephone`);
      }
      for (const e of arr(at("email") as string | string[])) {
        push("contact_email", clean(e, 120).replace(/^mailto:/i, ""), 0.95, `jsonld:${t}.email`);
      }

      const year = String(at("foundingDate") ?? "").match(/\b(1[89]\d{2}|20\d{2})\b/);
      if (year) push("founded_year", year[1], 0.9, `jsonld:${t}.foundingDate`);

      // address
      for (const a of arr(at("address") as Record<string, unknown> | Record<string, unknown>[])) {
        const line = typeof a === "string"
          ? clean(a)
          : [a?.streetAddress, a?.addressLocality, a?.addressRegion, a?.postalCode, a?.addressCountry]
              .map((x) => clean(x, 80))
              .filter(Boolean)
              .join(", ");
        push("address", line, 0.95, `jsonld:${t}.address`);
      }

      // area served
      for (const a of arr(at("areaServed") as unknown)) {
        const v = typeof a === "string" ? clean(a) : clean((a as Record<string, unknown>)?.name);
        push("service_area", v, 0.9, `jsonld:${t}.areaServed`);
      }

      // socials, labelled identically to the link rule so the two dedupe
      for (const s of arr(at("sameAs") as string | string[])) {
        const v = clean(s, 200);
        if (/^https?:\/\//i.test(v)) push("social_handles", labelSocial(v), 0.95, `jsonld:${t}.sameAs`);
      }

      // hours
      const hours = openingHours(n);
      if (hours) push("hours", hours, 0.95, `jsonld:${t}.openingHours`);

      // services
      for (const s of offerNames(n)) push("services", s, 0.9, `jsonld:${t}.offers`);
      for (const s of arr(at("knowsAbout") as string | string[])) {
        push("services", clean(s, 120), 0.7, `jsonld:${t}.knowsAbout`);
      }
      for (const s of arr(at("serviceType") as string | string[])) {
        push("services", clean(s, 120), 0.85, `jsonld:${t}.serviceType`);
      }

      // proof
      const rating = at("aggregateRating") as Record<string, unknown> | undefined;
      if (rating?.ratingValue) {
        const count = rating.reviewCount ?? rating.ratingCount;
        push(
          "reviews_summary",
          `${clean(rating.ratingValue, 10)} out of ${clean(rating.bestRating ?? 5, 10)}${count ? ` from ${clean(count, 10)} reviews` : ""}`,
          0.9,
          `jsonld:${t}.aggregateRating`,
        );
      }
      for (const a of arr(at("award") as string | string[])) {
        push("credentials", clean(a, 200), 0.85, `jsonld:${t}.award`);
      }

      // people
      for (const key of ["founder", "employee", "member"]) {
        for (const p of arr(at(key) as unknown)) {
          const name = typeof p === "string" ? clean(p) : clean((p as Record<string, unknown>)?.name);
          const role = typeof p === "object" ? clean((p as Record<string, unknown>)?.jobTitle, 60) : "";
          if (name) push("team", role ? `${name}, ${role}` : name, 0.85, `jsonld:${t}.${key}`);
        }
      }

      // logo
      const logo = at("logo") ?? at("image");
      const logoUrl = typeof logo === "string" ? logo : clean((arr(logo)[0] as Record<string, unknown>)?.url);
      if (logoUrl && /^https?:\/\//i.test(logoUrl)) extras.logo_url = logoUrl.slice(0, 500);
    }

    // A WebSite node carries the site name even when no Organization exists.
    if (types.includes("WebSite")) {
      push("trading_name", clean(at("name")), 0.75, "jsonld:WebSite.name");
      push("one_liner", clean(at("description")), 0.7, "jsonld:WebSite.description");
    }

    // FAQ pages are pure gold and completely unambiguous.
    if (types.includes("FAQPage") || types.includes("Question")) {
      for (const q of arr(at("mainEntity") as unknown).concat(types.includes("Question") ? [n] : [])) {
        const qq = q as Record<string, unknown>;
        const question = clean(qq?.name, 200);
        const answerNode = qq?.acceptedAnswer as Record<string, unknown> | undefined;
        const answer = clean(answerNode?.text, 400).replace(/<[^>]+>/g, " ");
        if (question && answer) {
          push("faq_items", `${question} ${answer}`, 0.95, "jsonld:FAQPage");
        }
      }
    }
  }

  return { facts, extras };
}

function openingHours(n: Record<string, unknown>): string {
  const plain = arr(n.openingHours as string | string[]).map((h) => clean(h, 80)).filter(Boolean);
  if (plain.length) return plain.join("; ").slice(0, 400);

  const spec = arr(n.openingHoursSpecification as unknown) as Record<string, unknown>[];
  const parts = spec
    .map((s) => {
      const days = arr(s?.dayOfWeek as string | string[])
        .map((d) => String(d).split("/").pop()?.slice(0, 3))
        .filter(Boolean)
        .join(", ");
      const open = clean(s?.opens, 10);
      const close = clean(s?.closes, 10);
      if (!days) return "";
      if (!open && !close) return "";
      return `${days} ${open}-${close}`;
    })
    .filter(Boolean);
  return parts.join("; ").slice(0, 400);
}

function offerNames(n: Record<string, unknown>): string[] {
  const out: string[] = [];
  const catalogs = arr(n.hasOfferCatalog as unknown) as Record<string, unknown>[];
  for (const c of catalogs) {
    for (const item of arr(c?.itemListElement as unknown) as Record<string, unknown>[]) {
      const offered = (item?.itemOffered ?? item) as Record<string, unknown>;
      const name = clean(offered?.name ?? item?.name, 120);
      if (name) out.push(name);
    }
  }
  for (const o of arr(n.makesOffer as unknown) as Record<string, unknown>[]) {
    const offered = (o?.itemOffered ?? o) as Record<string, unknown>;
    const name = clean(offered?.name, 120);
    const price = clean(o?.price, 20);
    if (name) out.push(price ? `${name} (${price})` : name);
  }
  return out;
}

/* ------------------------------------------------------------ microdata */

function fromMicrodata(html: string, page: string): Harvested[] {
  if (!/itemscope/i.test(html)) return [];
  const facts: Harvested[] = [];
  const map: Record<string, [string, number]> = {
    name: ["trading_name", 0.8],
    legalName: ["legal_name", 0.85],
    telephone: ["contact_phone", 0.9],
    email: ["contact_email", 0.9],
    description: ["one_liner", 0.7],
    openingHours: ["hours", 0.85],
    priceRange: ["pricing", 0.8],
    streetAddress: ["address", 0.7],
    areaServed: ["service_area", 0.8],
    foundingDate: ["founded_year", 0.85],
  };

  // void elements carry the value in an attribute and have no closing tag
  const voidRe = /<(?:meta|link)\b([^>]*\bitemprop=["']([^"']+)["'][^>]*)>/gi;
  let v: RegExpExecArray | null;
  while ((v = voidRe.exec(html))) {
    const prop = v[2].trim().split(/\s+/)[0];
    const hit = map[prop];
    if (!hit) continue;
    const value = clean(
      v[1].match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? v[1].match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "",
      300,
    );
    if (!value) continue;
    const [field, conf] = hit;
    facts.push({
      field_key: field,
      value: field === "founded_year" ? (value.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[1] ?? "") : value,
      confidence: conf,
      rule: `microdata:${prop}`,
      page,
    });
  }

  const re = /<([a-z0-9]+)([^>]*\bitemprop=["']([^"']+)["'][^>]*)>([\s\S]{0,400}?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const prop = m[3].trim().split(/\s+/)[0];
    const hit = map[prop];
    if (!hit) continue;
    const contentAttr = m[2].match(/\bcontent=["']([^"']+)["']/i)?.[1];
    const value = clean(contentAttr ?? m[4].replace(/<[^>]+>/g, " "), 300);
    if (!value) continue;
    const [field, conf] = hit;
    facts.push({
      field_key: field,
      value: field === "founded_year" ? (value.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[1] ?? "") : value,
      confidence: conf,
      rule: `microdata:${prop}`,
      page,
    });
  }
  return facts.filter((f) => f.value);
}

/* ----------------------------------------------------------- meta tags */

function metaOf(html: string, name: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decode(m[1]).trim();
  }
  return "";
}

function fromMeta(html: string, page: string): { facts: Harvested[]; extras: HarvestExtras } {
  const facts: Harvested[] = [];
  const extras: HarvestExtras = {};

  const site = metaOf(html, "og:site_name") || metaOf(html, "application-name");
  if (site) facts.push({ field_key: "trading_name", value: clean(site, 120), confidence: 0.8, rule: "meta:og:site_name", page });

  const desc = metaOf(html, "og:description") || metaOf(html, "description");
  if (desc && desc.length > 20) {
    facts.push({ field_key: "one_liner", value: clean(desc, 300), confidence: 0.7, rule: "meta:description", page, quote: clean(desc, 160) });
  }

  const theme = metaOf(html, "theme-color");
  if (/^#[0-9a-f]{6}$/i.test(theme)) extras.theme_color = theme;

  const image = metaOf(html, "og:image");
  if (/^https?:\/\//i.test(image)) extras.logo_url = image.slice(0, 500);

  return { facts, extras };
}

/* --------------------------------------------------------------- links */

const SOCIAL_HOSTS: Array<[RegExp, string]> = [
  [/facebook\.com\/(?!sharer|share|dialog)/i, "Facebook"],
  [/instagram\.com\//i, "Instagram"],
  [/linkedin\.com\/(company|in)\//i, "LinkedIn"],
  [/(twitter|x)\.com\/(?!intent|share)/i, "X"],
  [/youtube\.com\/(c\/|channel\/|@|user\/)/i, "YouTube"],
  [/tiktok\.com\/@/i, "TikTok"],
  [/pinterest\.[a-z.]+\/(?!pin\/create)/i, "Pinterest"],
  [/yelp\.[a-z.]+\/biz\//i, "Yelp"],
  [/g\.page\/|goo\.gl\/maps|google\.[a-z.]+\/maps/i, "Google Business"],
  [/nextdoor\.com\//i, "Nextdoor"],
  [/houzz\.[a-z.]+\//i, "Houzz"],
  [/angi\.com\/|angieslist\.com\//i, "Angi"],
  [/bbb\.org\//i, "Better Business Bureau"],
];

/** One spelling for a social profile, whichever rule found it. */
function labelSocial(url: string): string {
  const hit = SOCIAL_HOSTS.find(([rx]) => rx.test(url));
  const bare = url.split("?")[0];
  return hit ? `${hit[1]}: ${bare}` : bare;
}

const BOOKING = /\b(book|booking|schedule|appointment|reserve|reservation|quote|estimate|consultation)\b/i;

function fromLinks(html: string, page: string, origin: string): Harvested[] {
  const facts: Harvested[] = [];
  const re = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seenSocial = new Set<string>();

  while ((m = re.exec(html))) {
    const href = decode(m[2]).trim();
    const text = clean(m[4].replace(/<[^>]+>/g, " "), 120);

    if (/^tel:/i.test(href)) {
      const num = href.replace(/^tel:/i, "").replace(/[^\d+()\-.\s]/g, "").trim();
      if (num.replace(/\D/g, "").length >= 7) {
        facts.push({ field_key: "contact_phone", value: num, confidence: 0.95, rule: "link:tel", page });
      }
      continue;
    }

    if (/^mailto:/i.test(href)) {
      const addr = href.replace(/^mailto:/i, "").split("?")[0].trim();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(addr)) {
        facts.push({ field_key: "contact_email", value: addr, confidence: 0.95, rule: "link:mailto", page });
      }
      continue;
    }

    if (!/^https?:\/\//i.test(href)) {
      // relative link: still useful for booking detection
      if (BOOKING.test(href) || BOOKING.test(text)) {
        try {
          facts.push({
            field_key: "booking_url",
            value: new URL(href, origin).href,
            confidence: 0.7,
            rule: "link:booking",
            page,
            quote: text,
          });
        } catch { /* ignore */ }
      }
      continue;
    }

    const social = SOCIAL_HOSTS.find(([rx]) => rx.test(href));
    if (social && !seenSocial.has(social[1])) {
      seenSocial.add(social[1]);
      facts.push({
        field_key: "social_handles",
        value: labelSocial(href),
        confidence: 0.9,
        rule: "link:social",
        page,
      });
      continue;
    }

    if ((BOOKING.test(href) || BOOKING.test(text)) && href.startsWith(origin) === false) {
      facts.push({ field_key: "booking_url", value: href.split("?")[0], confidence: 0.7, rule: "link:booking", page, quote: text });
    }
  }

  return facts;
}

/* ---------------------------------------------------------- text rules */

const MONTHS = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)";

function fromText(text: string, html: string, page: string): Harvested[] {
  const facts: Harvested[] = [];
  const add = (field_key: string, value: string, confidence: number, rule: string, quote?: string) => {
    if (value) facts.push({ field_key, value, confidence, rule, quote, page });
  };

  // founded
  const est = text.match(/\b(?:est(?:ablished)?\.?|since|serving[^.]{0,40}since|founded(?:\s+in)?)\s+(1[89]\d{2}|20\d{2})\b/i);
  if (est) add("founded_year", est[1], 0.75, "text:established", est[0].slice(0, 80));

  // family owned, generations, veteran owned: differentiators worth having
  for (const rx of [
    /\b(family[- ]owned(?:\s+and\s+operated)?)\b/i,
    /\b(veteran[- ]owned)\b/i,
    /\b(woman[- ]owned|women[- ]owned)\b/i,
    /\b(locally[- ]owned)\b/i,
    /\b(third|second|fourth)[- ]generation\b/i,
    /\b(licen[cs]ed\s+and\s+insured)\b/i,
    /\b(free\s+estimates?)\b/i,
    /\b(24\/7|24 hours a day|around the clock)\b/i,
    /\b(same[- ]day\s+service)\b/i,
    /\b(no\s+call[- ]out\s+fee)\b/i,
  ]) {
    const m = text.match(rx);
    if (m) add("differentiators", clean(m[0], 80), 0.65, "text:claim", clean(m[0], 120));
  }

  // hours line
  const hours = text.match(
    new RegExp(`${MONTHS}[a-z]*\\.?\\s*(?:-|–|to|through)?\\s*${MONTHS}?[a-z]*\\.?\\s*:?\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*(?:-|–|to)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)`, "i"),
  );
  if (hours) add("hours", clean(hours[0], 120), 0.6, "text:hours", clean(hours[0], 120));

  // service area
  const serving = text.match(/\b(?:proudly\s+)?serving\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*(?:\s*,\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*){0,6})/);
  if (serving && serving[1].length > 3) {
    add("service_area", clean(serving[1], 200), 0.6, "text:serving", clean(serving[0], 160));
  }

  // licence numbers
  const lic = text.match(/\b(?:licen[cs]e|lic\.?|reg(?:istration)?\.?)\s*(?:no\.?|number|#)\s*([A-Z0-9-]{4,20})/i);
  if (lic) add("trade_licenses", clean(lic[0], 80), 0.8, "text:license", clean(lic[0], 100));

  // phone and email fallbacks, only when the link rules found nothing
  const phone = text.match(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/);
  if (phone) add("contact_phone", phone[0], 0.6, "text:phone", clean(phone[0], 40));

  const email = html.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (email && !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email[0])) {
    add("contact_email", email[0], 0.6, "text:email");
  }

  // an <address> element is a strong, cheap signal
  const addr = html.match(/<address[^>]*>([\s\S]{0,300}?)<\/address>/i);
  if (addr) {
    const v = clean(addr[1].replace(/<[^>]+>/g, " "), 200);
    if (v.length > 10) add("address", v, 0.7, "html:address");
  }

  return facts;
}

/* ------------------------------------------------------------ assemble */

/** Rank rules so the most trustworthy value for a field wins. */
function rulePriority(rule: string): number {
  if (rule.startsWith("jsonld:")) return 4;
  if (rule.startsWith("link:")) return 4;
  if (rule.startsWith("microdata:")) return 3;
  if (rule.startsWith("meta:")) return 2;
  if (rule.startsWith("html:")) return 2;
  return 1;
}

const SINGLE_VALUE = new Set([
  "trading_name", "legal_name", "one_liner", "founded_year", "mission",
  "hours", "address", "service_area", "booking_url", "pricing", "reviews_summary",
]);

export function harvestPage(html: string, page: string): { facts: Harvested[]; extras: HarvestExtras } {
  let origin = page;
  try {
    origin = new URL(page).origin;
  } catch { /* pasted text has no origin */ }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const ld = fromJsonLd(html, page);
  const meta = fromMeta(html, page);

  return {
    facts: [
      ...ld.facts,
      ...fromMicrodata(html, page),
      ...meta.facts,
      ...fromLinks(html, page, origin),
      ...fromText(text, html, page),
    ].filter((f) => f.value && f.value.length > 1),
    extras: { ...meta.extras, ...ld.extras },
  };
}

/** Merge across pages: best rule wins per value, single-value fields keep one. */
export function mergeHarvest(all: Harvested[]): Harvested[] {
  const byField = new Map<string, Harvested[]>();
  for (const f of all) {
    const norm = f.value.toLowerCase().replace(/\s+/g, " ").trim();
    const list = byField.get(f.field_key) ?? [];
    const dupe = list.find((x) => x.value.toLowerCase().replace(/\s+/g, " ").trim() === norm);
    if (dupe) {
      // keep the better-sourced copy of the same value
      if (rulePriority(f.rule) > rulePriority(dupe.rule) || f.confidence > dupe.confidence) {
        Object.assign(dupe, f);
      }
      continue;
    }
    list.push(f);
    byField.set(f.field_key, list);
  }

  const out: Harvested[] = [];
  for (const [field, list] of byField) {
    list.sort((a, b) => rulePriority(b.rule) - rulePriority(a.rule) || b.confidence - a.confidence);
    out.push(...(SINGLE_VALUE.has(field) ? list.slice(0, 1) : list.slice(0, MAX_PER_FIELD)));
  }
  return out;
}
