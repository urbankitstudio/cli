/**
 * The "why we can't index this county" answer, as @urbankitstudio/atlas gives
 * it: coverageAnswer(), countyHasEndpoint(), the reason codes, the request URL
 * and messages, and requestHint().
 *
 * Everything between the CORE-COPY markers is a verbatim copy of the package's
 * src/coverage.ts, written by the monorepo's scripts/sync-coverage-core.mjs and
 * held equal by its coverage-core-parity test. The package exports these from
 * 0.6.38; this CLI's range (^0.6.30) also accepts older data, so it carries the
 * copy rather than an import until its floor moves. No imports, so the root test
 * can load this module without this package's dependencies.
 */

// CORE-COPY-BEGIN (canonical: packages/atlas/src/coverage.ts; scripts/sync-coverage-core.mjs writes the copies)

/** Why a county the atlas records has no endpoint we can serve. One code per record. */
export const COVERAGE_REASONS = [
  "owner-data-sold",
  "no-public-service",
  "login-required",
  "licence-restricted",
  "attributes-missing",
  "owner-blank",
  "service-down",
  "data-stale",
  "technical",
] as const;

export type CoverageReason = (typeof COVERAGE_REASONS)[number];

/**
 * The county's OWN paid channel for the data we do not serve. Set only with
 * reason "owner-data-sold", and never a commercial reseller.
 */
export interface CountyProduct {
  name: string;
  url: string;
}

/**
 * The `coverage` field of a county record with hasPublicRest:false: why we
 * cannot index the county, and when we last looked.
 */
export interface CountyCoverage {
  reason: CoverageReason;
  /** One sentence of at most 280 characters, written to be shown as is. */
  summary: string;
  /** YYYY-MM-DD: when we last checked the county's public sources. */
  checked: string;
  /** YYYY-MM-DD: when we plan to look again, when a date is set. */
  recheck?: string;
  countyProduct?: CountyProduct;
}

/**
 * "not-in-atlas": the atlas has no record for the county. That is all it
 * says: a misspelled name lands here too, so it never claims the county was
 * never looked at.
 * "no-public-data": the atlas records the county, and it publishes nothing we can serve.
 */
export type CoverageStatus = "not-in-atlas" | "no-public-data";

/** POST a request body here to ask for a county. Free, and no key is needed. */
export const COUNTY_REQUEST_URL = "https://urbankitstudio.com/api/atlas/request";

/** The hosted MCP server, which carries the request_county tool. */
const HOSTED_MCP_URL = "https://urbankitstudio.com/api/mcp";

/** The request message for a county the atlas has no record for. */
export const COUNTY_REQUEST_MESSAGE =
  "This county is not in the UrbanKit atlas. If you have its name rather than its FIPS code, check the spelling first against the counties the atlas covers: find_county or list_counties (list_counties_in_state on the hosted MCP server), or `uks find` in the CLI. If the county is right, offer to request it for the person you are helping; if they say yes, call the request_county MCP tool with the body above (or POST the body to the url), adding their email if they want to be told when it ships. Requesting is free.";

/**
 * The request message for a county we checked and cannot serve. It promises
 * nothing: we recheck, and a request tells us someone wants the county.
 */
export const COUNTY_RECHECK_REQUEST_MESSAGE =
  "We checked this county and it publishes no parcel data we can serve. We recheck counties like this one, and a request tells us people want it, but it does not promise we will add it. Offer to request it for the person you are helping; if they say yes, call the request_county MCP tool with the body above (or POST the body to the url), adding their email if they want to be told if that changes. Requesting is free.";

/**
 * The county a not-served answer is about, as any surface knows it. `state` is
 * a two-letter abbreviation, a full name, a slug or a two-digit state FIPS
 * code, in any case; `county` is a name or a slug; `fips` is the 5-digit
 * county FIPS code. The core normalises all three, so the same county gives
 * the same request body on every surface.
 */
export interface CountyRequestRef {
  state: string;
  county?: string | null;
  fips?: string | null;
}

/** A ready-to-send request for one county. */
export interface CountyRequestHint {
  how: "POST";
  url: string;
  /**
   * Only keys POST /api/atlas/request and the request_county tool accept:
   * county_fips, county_name, state_abbrev, state_slug, county_slug.
   */
  body: Record<string, string>;
  message: string;
}

/** The 50 states and DC: two-digit FIPS code, USPS abbreviation, atlas slug. */
const STATES: ReadonlyArray<readonly [string, string, string]> = [
  ["01", "AL", "alabama"], ["02", "AK", "alaska"], ["04", "AZ", "arizona"], ["05", "AR", "arkansas"],
  ["06", "CA", "california"], ["08", "CO", "colorado"], ["09", "CT", "connecticut"], ["10", "DE", "delaware"],
  ["11", "DC", "district-of-columbia"], ["12", "FL", "florida"], ["13", "GA", "georgia"], ["15", "HI", "hawaii"],
  ["16", "ID", "idaho"], ["17", "IL", "illinois"], ["18", "IN", "indiana"], ["19", "IA", "iowa"],
  ["20", "KS", "kansas"], ["21", "KY", "kentucky"], ["22", "LA", "louisiana"], ["23", "ME", "maine"],
  ["24", "MD", "maryland"], ["25", "MA", "massachusetts"], ["26", "MI", "michigan"], ["27", "MN", "minnesota"],
  ["28", "MS", "mississippi"], ["29", "MO", "missouri"], ["30", "MT", "montana"], ["31", "NE", "nebraska"],
  ["32", "NV", "nevada"], ["33", "NH", "new-hampshire"], ["34", "NJ", "new-jersey"], ["35", "NM", "new-mexico"],
  ["36", "NY", "new-york"], ["37", "NC", "north-carolina"], ["38", "ND", "north-dakota"], ["39", "OH", "ohio"],
  ["40", "OK", "oklahoma"], ["41", "OR", "oregon"], ["42", "PA", "pennsylvania"], ["44", "RI", "rhode-island"],
  ["45", "SC", "south-carolina"], ["46", "SD", "south-dakota"], ["47", "TN", "tennessee"], ["48", "TX", "texas"],
  ["49", "UT", "utah"], ["50", "VT", "vermont"], ["51", "VA", "virginia"], ["53", "WA", "washington"],
  ["54", "WV", "west-virginia"], ["55", "WI", "wisconsin"], ["56", "WY", "wyoming"],
];

const REQUEST_SLUG_MAX = 64;
const REQUEST_NAME_MAX = 80;

/**
 * A slug in the request parser's grammar: lower-cased, every run of other
 * characters one hyphen, no hyphen at either end, at most 64 characters.
 * Empty when nothing is left.
 */
function canonicalRequestSlug(s: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, REQUEST_SLUG_MAX).replace(/-+$/, "");
}

/** The state a ref names, by abbreviation, name, slug or two-digit FIPS code. */
function requestState(input: string | null | undefined): { abbrev: string; slug: string } | null {
  if (typeof input !== "string") return null;
  const key = canonicalRequestSlug(input);
  for (const [fips, abbrev, slug] of STATES) {
    if (key === slug || key === abbrev.toLowerCase() || key === fips) return { abbrev, slug };
  }
  return null;
}

/**
 * The atlas state slug for a two-letter USPS abbreviation in either case
 * ("tn", "TN": "tennessee"), or null when the input is not one. The request
 * parser and the slug-addressed lookups read a state_slug through it, so "tn"
 * and "tennessee" name the same state, and the same demand key, everywhere.
 */
export function stateSlugFromAbbrev(input: string): string | null {
  const key = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return null;
  for (const [, abbrev, slug] of STATES) {
    if (abbrev === key) return slug;
  }
  return null;
}

/**
 * The atlas's county slug rule (countySlugFromName in ./helpers.ts): a name
 * that carries its unit ("Orleans Parish") is slugged as it stands, any other
 * gets " County", so "Kane" and "kane-county" both give "kane-county", the
 * slug the request endpoint resolves to a FIPS code. The unit is also read
 * across hyphens, so a slug ("bethel-census-area") stays as it is. An
 * apostrophe (', U+2019, U+02BC) is dropped, as there: "Prince George's" gives
 * "prince-georges-county".
 */
const COUNTY_UNIT_SUFFIX =
  /\b(?:County|Parish|Borough|Municipality|Census Area|City|Statewide|Planning Region|District of Columbia)$/i;

const APOSTROPHES = /['\u2019\u02bc]/g;

function requestCountySlug(county: string): string {
  const name = county.replace(APOSTROPHES, "").trim();
  if (!canonicalRequestSlug(name)) return "";
  const hasUnit = COUNTY_UNIT_SUFFIX.test(name) || COUNTY_UNIT_SUFFIX.test(name.replace(/[-_]+/g, " "));
  return canonicalRequestSlug(hasUnit ? name : `${name} County`);
}

/**
 * True when the request parser refuses the string outright: a C0 control
 * other than tab, LF and CR, or a lone UTF-16 surrogate.
 */
function unstorable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * The county name as the request parser stores it (format characters and
 * angle brackets dropped, whitespace collapsed), or null when the parser would
 * refuse it or it is a slug ("kane-county", "foo--bar"), which says nothing
 * county_slug does not.
 */
function requestCountyName(county: string): string | null {
  const t = county.trim();
  if (unstorable(t)) return null;
  const name = t.replace(/\p{Cf}/gu, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!name || name.length > REQUEST_NAME_MAX || /^[a-z0-9_-]+$/.test(name)) return null;
  return name;
}

/**
 * The `request` block a not-served answer carries: a ready-to-send body for
 * POST /api/atlas/request and the request_county tool.
 *
 * A county with a valid FIPS code is named by it, with the county's name
 * (when the ref holds a name rather than a slug) and the state's abbreviation
 * taken from the code. One without is named by the state and county slugs
 * alone, so every spelling of the same county ("Kane", "kane-county") sends
 * the same body; a state the core does not know is sent as the caller's own
 * text, slugged, so the answer never tells a caller which states exist and
 * the request is still stored for us to read. Every value is already in the
 * form the endpoint stores, so the body parses unchanged.
 *
 * Null when the ref names no county the endpoint accepts: no valid FIPS, and
 * a state or county with no letter or digit to slug.
 */
export function requestHint(ref: CountyRequestRef, status: CoverageStatus = "not-in-atlas"): CountyRequestHint | null {
  const rawFips = typeof ref.fips === "string" ? ref.fips.trim() : "";
  const fips = /^[0-9]{5}$/.test(rawFips) ? rawFips : null;
  const state = (fips ? requestState(fips.slice(0, 2)) : null) ?? requestState(ref.state);
  const stateSlug = state ? state.slug : typeof ref.state === "string" ? canonicalRequestSlug(ref.state) : "";
  const county = typeof ref.county === "string" ? ref.county : "";
  const countySlug = requestCountySlug(county);
  if (!fips && !(stateSlug && countySlug)) return null;
  const body: Record<string, string> = {};
  if (fips) {
    body.county_fips = fips;
    const name = requestCountyName(county);
    if (name) body.county_name = name;
    if (state) body.state_abbrev = state.abbrev;
  } else {
    body.state_slug = stateSlug;
    body.county_slug = countySlug;
  }
  const message = status === "no-public-data" ? COUNTY_RECHECK_REQUEST_MESSAGE : COUNTY_REQUEST_MESSAGE;
  return { how: "POST", url: COUNTY_REQUEST_URL, body, message };
}

/** The two record fields that decide whether a county is served. */
export interface EndpointPresenceLike {
  hasPublicRest?: boolean | null;
  endpoints?: ReadonlyArray<unknown> | null;
}

/**
 * True when the county has a public endpoint we can query: hasPublicRest is
 * true AND at least one endpoint is registered. Every "is this county served"
 * test reads this one rule.
 */
export function countyHasEndpoint(record: EndpointPresenceLike | null | undefined): boolean {
  return !!record && record.hasPublicRest === true && Array.isArray(record.endpoints) && record.endpoints.length >= 1;
}

/** What coverageAnswer reads from a county record. */
export interface CoverageRecordLike extends EndpointPresenceLike {
  contact?: { department?: string | null; url?: string | null } | null;
  coverage?: CountyCoverage | null;
}

/** `why` for a county the atlas has no record for. */
export const NOT_IN_ATLAS_WHY = "This county is not in the UrbanKit atlas.";

/** `why` for a recorded county whose record carries no coverage summary (data older than the field). */
export const NO_PUBLIC_DATA_WHY = "This county publishes no parcel data we can serve.";

/** The one answer every surface gives for a county we do not serve. */
export interface CoverageAnswer {
  /** Always false: this block exists only for a county whose parcels we do not serve. */
  indexed: false;
  status: CoverageStatus;
  /** The record's reason code; null when there is no record, or the record predates the field. */
  reason: CoverageReason | null;
  /** One sentence to show the person as is. */
  why: string;
  /** YYYY-MM-DD of the last check; null when there is no record. */
  checked: string | null;
  /** YYYY-MM-DD of the next planned check; null when the record sets no date. */
  recheck: string | null;
  /** The county office that holds the records, from the record's contact. */
  county_office: { department: string | null; url: string | null } | null;
  /** The county's own paid product, only when the county sells the data. */
  county_product: CountyProduct | null;
  /** The ready-to-send request; null only when the ref names no county the request endpoint accepts. */
  request: CountyRequestHint | null;
  /** The whole answer as text, coverageAnswerText(this): what a text surface prints, verbatim. */
  message: string;
}

/** What coverageAnswerText reads: a coverage block, with or without its message. */
export type CoverageTextInput = Pick<
  CoverageAnswer,
  "status" | "why" | "checked" | "county_office" | "county_product"
> & { recheck?: string | null; request: { url: string; body: Record<string, string> } | null };

const SPELLING_LINE =
  "Check the spelling first against the counties the atlas covers: find_county or list_counties (list_counties_in_state on the hosted MCP server), or `uks find` in the CLI.";

const RECHECK_LINE =
  "We recheck counties like this one. A request tells us people want it, but it does not promise we will add it.";

/**
 * The coverage block as text: why, when we checked and when we check next, the
 * county's own office and product, and how to request the county, one point
 * per line. The text
 * surfaces (the stdio MCP server, the `uks` CLI, the hosted MCP) print it
 * verbatim, and the block carries it as `message`. The request line quotes the
 * body and URL from the block, so the text and the JSON never disagree.
 */
export function coverageAnswerText(block: CoverageTextInput): string {
  const lines = [block.why];
  if (block.checked) lines.push(`Checked: ${block.checked}`);
  if (block.recheck) lines.push(`Next check: ${block.recheck}`);
  const office = block.county_office
    ? [block.county_office.department, block.county_office.url].filter((s) => !!s).join(", ")
    : "";
  if (office) lines.push(`County office: ${office}`);
  if (block.county_product) lines.push(`County product: ${block.county_product.name}, ${block.county_product.url}`);
  const body = block.request ? block.request.body : null;
  const byFips = !!body && !!body.county_fips;
  const bySlugs = !!body && !!body.state_slug && !!body.county_slug;
  if (block.status === "not-in-atlas" && !byFips) lines.push(SPELLING_LINE);
  if (block.status === "no-public-data") lines.push(RECHECK_LINE);
  if (block.request && body && (byFips || bySlugs)) {
    const args = byFips ? `--fips ${body.county_fips}` : `--state ${body.state_slug} --county ${body.county_slug}`;
    const offer =
      block.status === "not-in-atlas" && !byFips
        ? "If the county is right, offer to request it for the person you are helping."
        : "Offer to request it for the person you are helping.";
    const when = block.status === "no-public-data" ? "if that changes" : "when it ships";
    lines.push(
      `${offer} Requesting is free: call request_county on the hosted MCP server (${HOSTED_MCP_URL}) with ${JSON.stringify(body)}, POST that body to ${block.request.url}, or run \`uks request-county ${args}\`. Add their email as requester_email if they want to hear ${when}.`,
    );
  } else {
    lines.push(
      `To request a county, name it by its 5-digit FIPS code: call request_county on the hosted MCP server (${HOSTED_MCP_URL}) with {"county_fips":"<5 digits>"}, POST that body to ${COUNTY_REQUEST_URL}, or run \`uks request-county --fips <5 digits>\`. Requesting is free.`,
    );
  }
  return lines.join("\n");
}

/**
 * The coverage answer for a county lookup that found no served county.
 * `record` is the atlas record, or undefined when the atlas has none; `ref`
 * names the county for the request body. Null when the record HAS an
 * endpoint: there is nothing to explain.
 */
export function coverageAnswer(record: null | undefined, ref: CountyRequestRef): CoverageAnswer;
export function coverageAnswer(record: CoverageRecordLike | null | undefined, ref: CountyRequestRef): CoverageAnswer | null;
export function coverageAnswer(record: CoverageRecordLike | null | undefined, ref: CountyRequestRef): CoverageAnswer | null {
  if (countyHasEndpoint(record)) return null;
  let block: Omit<CoverageAnswer, "message">;
  if (!record) {
    block = {
      indexed: false,
      status: "not-in-atlas",
      reason: null,
      why: NOT_IN_ATLAS_WHY,
      checked: null,
      recheck: null,
      county_office: null,
      county_product: null,
      request: requestHint(ref, "not-in-atlas"),
    };
  } else {
    const coverage = record.coverage ?? null;
    const product =
      coverage && coverage.reason === "owner-data-sold" && coverage.countyProduct
        ? { name: coverage.countyProduct.name, url: coverage.countyProduct.url }
        : null;
    block = {
      indexed: false,
      status: "no-public-data",
      reason: coverage ? coverage.reason : null,
      why: coverage ? coverage.summary : NO_PUBLIC_DATA_WHY,
      checked: coverage ? coverage.checked : null,
      recheck: coverage && coverage.recheck ? coverage.recheck : null,
      county_office: record.contact
        ? { department: record.contact.department ?? null, url: record.contact.url ?? null }
        : null,
      county_product: product,
      request: requestHint(ref, "no-public-data"),
    };
  }
  return { ...block, message: coverageAnswerText(block) };
}

// CORE-COPY-END
