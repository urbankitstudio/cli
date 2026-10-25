/**
 * The "this county is paused" answer, as @urbankitstudio/atlas gives it: the
 * flags, the presets, the reasons, accessBlocks() and pausedAnswer(), and the
 * "this county's server is down" sentence, countyDownMessage().
 *
 * Everything between the CORE-COPY markers is a verbatim copy of the package's
 * src/access.ts, written by the monorepo's scripts/sync-coverage-core.mjs and
 * held equal by its coverage-core-parity test. The package exports the paused
 * answer from 0.6.39 and countyDownMessage() from 0.6.40; this CLI's range also
 * accepts older data, so it carries the copy rather than an import until its
 * floor moves. No imports, so the root test can
 * load this module without this package's dependencies.
 */

// CORE-COPY-BEGIN (canonical: packages/atlas/src/access.ts; scripts/sync-coverage-core.mjs writes the copies)

/**
 * The surfaces a county can be paused on, one flag each. True = paused.
 *
 * "paid_lookup":      a REST lookup by a paying caller (PAYG or a paid plan).
 * "paid_enrich":      a billed single-parcel owner lookup (MCP enrich_address).
 * "paid_bulk":        a billed owner list of addresses (REST bulk rows).
 * "paid_lists":       a billed radius owner list (REST radius, MCP radius_owners).
 * "free_site_lookup": the site's free lookup tools, and a REST lookup by an
 *                     anonymous or free-tier caller.
 * "free_site_lists":  the site's free whole-layer download (ArcGIS to GeoJSON).
 * "free_discovery":   the county record beyond its identity (endpoint URLs,
 *                     notes, every other field) in county metadata and the
 *                     discovery tools.
 */
export const ACCESS_FLAGS = [
  "paid_lookup",
  "paid_enrich",
  "paid_bulk",
  "paid_lists",
  "free_site_lookup",
  "free_site_lists",
  "free_discovery",
] as const;

export type AccessFlag = (typeof ACCESS_FLAGS)[number];

export type AccessFlags = Readonly<Record<AccessFlag, boolean>>;

/**
 * Named sets of flags.
 *
 * "paid-off":       every billed call. Free use still answers.
 * "paid-lists-off": billed owner LISTS only (radius, bulk). Single-parcel
 *                   lookups still work.
 * "all-off":        everything, free use included.
 */
export const ACCESS_PRESETS = ["paid-off", "paid-lists-off", "all-off"] as const;

export type AccessPreset = (typeof ACCESS_PRESETS)[number];

export const PRESET_FLAGS: Readonly<Record<AccessPreset, readonly AccessFlag[]>> = {
  "paid-off": ["paid_lookup", "paid_enrich", "paid_bulk", "paid_lists"],
  "paid-lists-off": ["paid_bulk", "paid_lists"],
  "all-off": ACCESS_FLAGS,
};

/** The flags a preset sets: every flag present, true for the preset's own. */
export function flagsFor(preset: AccessPreset): AccessFlags {
  const on = new Set<AccessFlag>(PRESET_FLAGS[preset]);
  return Object.fromEntries(ACCESS_FLAGS.map((f) => [f, on.has(f)])) as AccessFlags;
}

/** The paused flags, in ACCESS_FLAGS order. */
export function pausedFlags(flags: AccessFlags): AccessFlag[] {
  return ACCESS_FLAGS.filter((f) => flags[f] === true);
}

/** The preset these flags are exactly, or "custom". */
export function presetOf(flags: AccessFlags): AccessPreset | "custom" {
  const paused = pausedFlags(flags).join(",");
  return ACCESS_PRESETS.find((p) => PRESET_FLAGS[p].join(",") === paused) ?? "custom";
}

/** Why a county is paused. One code per county. */
export const ACCESS_REASONS = [
  "licence-terms",
  "state-law",
  "county-request",
  "data-quality",
  "upstream-broken",
  "other",
] as const;

export type AccessReason = (typeof ACCESS_REASONS)[number];

/** One paused county, as the operator recorded it. */
export interface CountyAccessEntry {
  county_fips: string;
  flags: AccessFlags;
  reason: AccessReason;
  /** One sentence of at most 280 characters, written to be shown as is. */
  why: string;
  /** The county's own terms page, or the law, that the pause rests on. */
  citation_url: string;
  /** When the county was paused: an ISO timestamp, or YYYY-MM-DD. */
  since: string;
}

/** Is `flag` paused for this county? No entry means the county is fully on. */
export function accessBlocks(entry: { flags: AccessFlags } | null | undefined, flag: AccessFlag): boolean {
  return entry?.flags[flag] === true;
}

/** What pausedAnswer reads from a county record. */
export interface AccessRecordLike {
  contact?: { department?: string | null; url?: string | null; email?: string | null } | null;
  /** The record's own endpoints: their hosts are what a withheld answer must not name. */
  endpoints?: ReadonlyArray<{ url: string }> | null;
}

// `rest/services` starts a path segment: "forest/services" is a forestry page, not a REST path.
const ARCGIS_REST_RE =
  /(?:^|[^a-z0-9_-])rest\/services|sharing\/rest|arcgis\.com\/home\/item|(?:Map|Feature|Image|GP|VectorTile|Scene)Server/i;

/**
 * A contact value (department, url, email), or a pause's citation, as an
 * answer may show it while the county's endpoint URLs are withheld
 * (free_discovery): null when it names one of the record's own endpoint hosts
 * or an ArcGIS REST path. Some counties' contact url IS their GIS server, and
 * Pima's department names its MapServer. The value is read in several forms,
 * each with its percent-escapes decoded: plain (lower case); folded (NFKC,
 * lower case, the characters a reader does not see dropped: format characters
 * and the other default-ignorables); and each of those again with its control
 * characters deleted, as the URL parser deletes a tab or newline. Two passes
 * over them; either one nulls. The tokenizer: each dotted name (a URL's host,
 * an email's domain, a bare host) is parsed as a host and is the service when
 * it EQUALS an endpoint host (both without a leading `www.`) or is a name under
 * one (fiscalhub.gis.county.gov beside gis.county.gov), by hostname, lower
 * case, without a port or a trailing dot, in the URL parser's ASCII form. The
 * label boundary pass: an endpoint host without `www.` appears with no ASCII
 * letter or digit on either side (folded, unfolded and with only fullwidth
 * forms folded, each with the invisible characters kept and dropped), so any
 * punctuation, symbol, space, `-` or `_` beside it is a boundary. A parent or sibling host stays (county.gov or
 * assessor.county.gov beside gis.county.gov); a name under a www. endpoint's
 * domain does not (maps.county.gov beside www.county.gov). A URL a browser
 * would follow is also checked as the parser reads it: discoverySafeUrl. A
 * value longer than MAX_MATCHED_LENGTH, before or after folding, is null: the
 * stored ones are far shorter. Known limit: the matcher compares ASCII keys, and
 * validate-atlas keeps every endpoint host plain ASCII (no xn-- label, no `%`).
 * If a county ever needs an IDN host, the matcher must be extended first.
 */
export function discoverySafeContact(value: string | null | undefined, record: AccessRecordLike | null | undefined): string | null {
  if (!value) return null;
  if (value.length > MAX_MATCHED_LENGTH) return null;
  const d = decoded(value);
  const v = d.toLowerCase().replace(STOPS_RE, ".");
  const nfkc = d.normalize("NFKC").toLowerCase().replace(STOPS_RE, ".");
  const folded = nfkc.replace(IGNORABLE_RE, "");
  if (v.length > MAX_MATCHED_LENGTH || nfkc.length > MAX_MATCHED_LENGTH) return null;
  const texts = withControlsDeleted([v, folded]);
  if (texts.some((t) => ARCGIS_REST_RE.test(t))) return null;
  const endpoints: { key: string; host: string }[] = [];
  for (const ep of record?.endpoints ?? []) {
    const host = hostnameOf(ep.url);
    const key = host && hostKey(host);
    if (host && key) endpoints.push({ key, host });
  }
  if (endpoints.length === 0) return value;
  for (const form of texts) {
    for (const name of dottedNames(form)) {
      const host = hostnameOf(`http://${name}`);
      const key = host && hostKey(host);
      if (host && key && endpoints.some((ep) => key === ep.key || host.endsWith(`.${ep.host}`))) return null;
    }
  }
  // The boundary pass also reads the value unfolded and with only the fullwidth
  // ASCII forms (ｇｉｓ) folded, so a character NFKC folds into a letter or digit
  // (ⓐ, 𝟘) still counts as a boundary; and each with the invisible characters
  // kept as well as dropped, so one between the host and a letter is a boundary.
  const fullwidth = v.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const boundaryForms = withControlsDeleted([v, nfkc, fullwidth].flatMap((form) => [form, form.replace(IGNORABLE_RE, "")]));
  for (const ep of endpoints) {
    const bounded = labelBounded(ep.key);
    if (boundaryForms.some((form) => bounded.test(form))) return null;
  }
  return value;
}

/**
 * A url a withheld answer may link (a pause's citation, the county office's
 * url): discoverySafeContact on the text, and on the URL the parser makes of
 * it, which is the link a browser follows (safeHttpUrl renders that href). The
 * parser rewrites a host the text does not show: it deletes a tab or newline,
 * maps the name through IDNA, and reads a bare number as an IPv4 address.
 */
export function discoverySafeUrl(value: string | null | undefined, record: AccessRecordLike | null | undefined): string | null {
  const text = discoverySafeContact(value, record);
  if (text === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(text.trim());
  } catch {
    return text;
  }
  return discoverySafeContact(parsed.href, record) === null ? null : text;
}

/** Longer than any stored why (280), citation (500) or record contact value. */
const MAX_MATCHED_LENGTH = 2048;

/** Ideographic, fullwidth and halfwidth ideographic full stops: dots. */
const STOPS_RE = /[。．｡]/g;

/**
 * Characters a reader does not see: format characters (a soft hyphen, a
 * zero-width space or joiner, a BOM) and the other default-ignorables (a
 * combining grapheme joiner, a variation selector, a Hangul filler).
 */
const IGNORABLE_RE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** Control characters: what the URL parser deletes (a tab, a newline) among them. */
const CONTROL_RE = /\p{Cc}/gu;

/**
 * `forms`, and each one that has a control character with them deleted: the
 * URL parser deletes a tab or newline, so `gis.gaston\tcountync.gov` is a link
 * to gis.gastoncountync.gov. Beside the form, not instead of it: deleting a
 * newline everywhere would glue `host\nword` into one name.
 */
function withControlsDeleted(forms: readonly string[]): string[] {
  const out = [...forms];
  for (const form of forms) {
    const deleted = form.replace(CONTROL_RE, "");
    if (deleted !== form) out.push(deleted);
  }
  return out;
}

/**
 * `key` with no ASCII letter or digit on either side. The key is in the URL
 * parser's ASCII form, so only an ASCII letter or digit can continue its label:
 * any other character beside it, a CJK letter or an Arabic-Indic digit among
 * them, is a boundary. No lookbehind: the package runs in older browsers.
 */
function labelBounded(key: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${key.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")}(?![a-z0-9])`, "u");
}

/** A run of label characters and dots; scanned once, so a long run without a dot costs one pass. */
const NAME_RUN_RE = /[\p{L}\p{N}\p{M}_.-]+/gu;

/** The dotted names in `form`: two or more labels of letters, digits, marks, `_` or `-`. */
function dottedNames(form: string): string[] {
  const names: string[] = [];
  for (const run of form.match(NAME_RUN_RE) ?? []) {
    for (const part of run.split(/\.{2,}/)) {
      const name = part.replace(/^\.+|\.+$/g, "");
      if (name.includes(".")) names.push(name);
    }
  }
  return names;
}

/** Each run of percent-escapes decoded on its own, so one stray `%` cannot stop the rest decoding. */
function decoded(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function hostKey(hostname: string): string | null {
  const h = hostname.replace(/^www\./, "");
  return h.includes(".") || h.includes(":") ? h : null;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
}

/** Where the county's free page lives. Either slug missing: no page offered. */
export interface AccessPageRef {
  state_slug?: string | null;
  county_slug?: string | null;
}

export const ATLAS_COUNTY_PAGE_BASE = "https://urbankitstudio.com/parcel-atlas";

/** The one answer every surface gives for a county that is paused. */
export interface CountyPausedAnswer {
  /** Always true: the county IS in the atlas. */
  indexed: true;
  status: "paused";
  /** The preset the flags match, or "custom". */
  preset: AccessPreset | "custom";
  /** Which surfaces are paused, in ACCESS_FLAGS order. */
  paused: AccessFlag[];
  reason: AccessReason;
  /** One sentence to show the person as is. Null under free_discovery when it
   *  names the county's service (discoverySafeContact). */
  why: string | null;
  /** The county's own terms page, or the law, that the pause rests on. Null
   *  under free_discovery when it names the county's service (discoverySafeContact). */
  citation_url: string | null;
  since: string;
  /** The county office that holds the records, from the record's contact: its
   *  department, url and email, each as the record has it. Under free_discovery
   *  a value naming the county's service is null (discoverySafeContact), an
   *  email at an endpoint host included; the email is otherwise shown, since it
   *  is how a person asks the county for the data this answer cannot give. */
  county_office: { department: string | null; url: string | null; email: string | null } | null;
  /** The free county page; null when free lookup or discovery is paused, or the page is unknown. */
  free_alternatives: { county_page: string } | null;
  /** Always null: a paused county is not something to request. */
  request: null;
}

/** The paused answer for one county. `record` is its atlas record when known. */
export function pausedAnswer(
  entry: CountyAccessEntry,
  record: AccessRecordLike | null | undefined,
  page: AccessPageRef = {},
): CountyPausedAnswer {
  const withheld = accessBlocks(entry, "free_discovery");
  const freeOff = accessBlocks(entry, "free_site_lookup") || withheld;
  const office = (v: string | null | undefined, check = discoverySafeContact) => (withheld ? check(v, record) : (v ?? null));
  const pageUrl =
    !freeOff && page.state_slug && page.county_slug
      ? `${ATLAS_COUNTY_PAGE_BASE}/${page.state_slug}/${page.county_slug}`
      : null;
  return {
    indexed: true,
    status: "paused",
    preset: presetOf(entry.flags),
    paused: pausedFlags(entry.flags),
    reason: entry.reason,
    why: withheld ? discoverySafeContact(entry.why, record) : entry.why,
    citation_url: withheld ? discoverySafeUrl(entry.citation_url, record) : entry.citation_url,
    since: entry.since,
    county_office: record?.contact
      ? {
          department: office(record.contact.department),
          url: office(record.contact.url, discoverySafeUrl),
          email: office(record.contact.email),
        }
      : null,
    free_alternatives: pageUrl ? { county_page: pageUrl } : null,
    request: null,
  };
}

/**
 * The one sentence every surface gives for a county whose own GIS server is
 * down: the liveness probe observed `down`, the operator paused it with reason
 * `upstream-broken`, or a county query failed on the county's side
 * (`county-unavailable`). It names the county's end, not ours, and says nothing
 * about money: whether a call was charged is that call's fact, so each surface
 * appends its own conditional charge clause (the enrichment-billing.ts rule).
 * `countyName` is the name as that surface shows it ("Fulton", "Kane County");
 * unknown, the sentence says "The county's".
 */
export function countyDownMessage(countyName: string | null | undefined): string {
  const whose = countyName ? `${countyName}'s` : "The county's";
  return `${whose} GIS server is down on the county's end, so its parcel data can't be reached right now. Try again later, or use the county office's own site.`;
}

// CORE-COPY-END
