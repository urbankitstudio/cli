// Offline county discovery from @urbankitstudio/atlas. No network: everything
// here reads the data bundled in the installed package, so the endpoint
// `status` is the publish-time stamp, not a live probe (live_status_url says
// where to ask).
import {
  atlas,
  atlasIndex,
  buildParcelLookupDeepLink,
  countyOffersAttributeSearch,
  countySlugFromName,
  findCounty,
  findCountyByFips,
  LIVE_STATUS_URL,
  offersAttributeSearch,
  reviewedCapability,
  slugify,
  type CountyRecord,
  type EndpointRecord,
  type StateIndexEntry,
} from "@urbankitstudio/atlas";
import type { Context } from "../context.js";
import { emit, SITE } from "../context.js";
import { EXIT, usageError } from "../errors.js";
import { fields, table } from "../format.js";
import { atlasPackageVersion } from "../version.js";

const COUNTY_REQUEST_MESSAGE =
  "This county is not in the UrbanKit atlas yet. POST the body above to request it (free), run the uks request-county command shown, or call the request_county MCP tool.";

function dataStamp() {
  return {
    source: "bundled @urbankitstudio/atlas data (offline)",
    atlas_package: atlasPackageVersion(),
    data_last_updated: atlasIndex.lastUpdated,
  };
}

/** "Kane" -> "Kane County"; names that already carry a unit ("Orleans Parish") stay as they are. */
export function countyDisplayName(name: string): string {
  return countySlugFromName(name) === slugify(name) ? name : `${name} County`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stateByToken(token: string): StateIndexEntry | undefined {
  const t = norm(token);
  if (!t) return undefined;
  return atlasIndex.states.find(
    (s) => norm(s.name) === t || s.slug === slugify(t) || (t.length === 2 && s.abbrev.toLowerCase() === t),
  );
}

const COUNTY_REQUEST_INCOMPLETE_MESSAGE =
  "No county matched, so the request body is incomplete. Fill in the fields named in `missing` (`uks states` lists the state slugs), then POST it to request the county (free), or run the uks request-county command with the placeholders replaced.";

/** The request-county hint for a miss. A name miss with no state yields a body with `missing` fields and placeholders in the command. */
function requestHint(ctx: Context, body: Record<string, string>) {
  const missing = body.county_fips ? [] : ["state_slug", "county_slug"].filter((k) => !body[k]);
  const args = body.county_fips
    ? `--fips ${body.county_fips}`
    : `--state ${body.state_slug ?? "<state-slug>"} --county ${body.county_slug ?? "<county-slug>"}`;
  return {
    how: "POST",
    url: `${ctx.apiBase}/api/atlas/request`,
    body,
    ...(missing.length ? { missing } : {}),
    message: missing.length ? COUNTY_REQUEST_INCOMPLETE_MESSAGE : COUNTY_REQUEST_MESSAGE,
    command: `uks request-county ${args}`,
  };
}

// ---------------------------------------------------------------- states

export async function statesCommand(ctx: Context): Promise<number> {
  const states = atlasIndex.states.filter((s) => s.populated);
  const doc = {
    ok: true,
    ...dataStamp(),
    totals: atlasIndex.totals,
    states: states.map((s) => ({
      slug: s.slug,
      name: s.name,
      abbrev: s.abbrev,
      county_count: s.countyCount,
      endpoint_count: s.endpointCount,
    })),
  };
  emit(ctx, doc, () => {
    const t = atlasIndex.totals;
    return [
      table(
        ["STATE", "ABBR", "SLUG", "COUNTIES", "ENDPOINTS"],
        states.map((s) => [s.name, s.abbrev, s.slug, String(s.countyCount), String(s.endpointCount)]),
      ),
      "",
      `${states.length} states, ${t.counties} counties, ${t.endpoints} endpoints (${t.countiesWithEndpoint} counties with an endpoint). Atlas data ${atlasIndex.lastUpdated}.`,
    ].join("\n");
  });
  return EXIT.OK;
}

// ---------------------------------------------------------------- find

type MatchKind = "fips" | "exact" | "prefix" | "contains" | "fuzzy" | "state";

interface Hit {
  county: CountyRecord;
  score: number;
  match: MatchKind;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function allCounties(): CountyRecord[] {
  const out: CountyRecord[] = [];
  for (const s of atlas.byStateSlug.values()) out.push(...s.counties);
  return out;
}

function scoreCounty(q: string, c: CountyRecord): Hit | null {
  const bare = norm(c.county);
  const full = norm(countyDisplayName(c.county));
  if (q === bare || q === full) return { county: c, score: 100, match: "exact" };
  if (bare.startsWith(q) || full.startsWith(q)) return { county: c, score: 80, match: "prefix" };
  if (q.length >= 3 && full.includes(q)) return { county: c, score: 60, match: "contains" };
  const d = Math.min(levenshtein(q, bare), levenshtein(q, full));
  const allowed = q.length >= 6 ? 2 : q.length >= 4 ? 1 : 0;
  if (allowed > 0 && d <= allowed) return { county: c, score: 40 - d, match: "fuzzy" };
  return null;
}

/** Splits a trailing state ("IL", "Illinois", "New York") off the query, when something is left in front of it. */
function splitState(tokens: string[]): { rest: string[]; state?: StateIndexEntry } {
  for (let k = Math.min(3, tokens.length - 1); k >= 1; k--) {
    const state = stateByToken(tokens.slice(-k).join(" "));
    if (state) return { rest: tokens.slice(0, -k), state };
  }
  return { rest: tokens };
}

export function findCounties(query: string, limit = 10) {
  const trimmed = query.trim();
  if (/^\d{5}$/.test(trimmed)) {
    const c = findCountyByFips(trimmed);
    return {
      stateFilter: null as StateIndexEntry | null,
      name: "",
      hits: c ? [{ county: c, score: 100, match: "fips" as MatchKind }] : [],
      total: c ? 1 : 0,
    };
  }
  const tokens = norm(trimmed).split(" ").filter(Boolean);
  const { rest, state } = splitState(tokens);
  if (rest.length > 1 && rest[rest.length - 1] === "county") rest.pop();
  const q = rest.join(" ");
  const pool = state ? atlas.byStateSlug.get(state.slug)?.counties ?? [] : allCounties();
  let hits: Hit[] = q ? pool.map((c) => scoreCounty(q, c)).filter((h): h is Hit => h !== null) : [];
  let stateFilter = state ?? null;
  if (hits.length === 0 && !state) {
    // The whole query may be a state ("Illinois", "IL"): list its counties.
    const whole = stateByToken(trimmed);
    if (whole) {
      stateFilter = whole;
      hits = (atlas.byStateSlug.get(whole.slug)?.counties ?? []).map((c) => ({ county: c, score: 50, match: "state" as MatchKind }));
    }
  }
  hits.sort(
    (a, b) => b.score - a.score || a.county.stateName.localeCompare(b.county.stateName) || a.county.county.localeCompare(b.county.county),
  );
  return { stateFilter, name: q, hits: hits.slice(0, limit), total: hits.length };
}

function hitDoc(h: Hit) {
  const c = h.county;
  return {
    county_name: countyDisplayName(c.county),
    county_slug: c.countySlug,
    county_fips: c.countyFips,
    state_slug: c.stateSlug,
    state_name: c.stateName,
    state_abbrev: c.state,
    has_public_rest: c.hasPublicRest,
    endpoint_count: c.endpoints.length,
    match: h.match,
    command: `uks county ${c.stateSlug} ${c.countySlug}`,
  };
}

export async function findCommand(ctx: Context, positionals: string[], opts: { limit?: string }): Promise<number> {
  const query = positionals.join(" ").trim();
  if (!query) throw usageError("find needs a query: a county name (\"Kane IL\", \"Kane County, Illinois\") or a 5-digit FIPS.");
  let limit = 10;
  if (opts.limit !== undefined) {
    limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw usageError("--limit must be a whole number from 1 to 500.");
  }
  const { stateFilter, name, hits, total } = findCounties(query, limit);
  const isFips = /^\d{5}$/.test(query);
  let request: ReturnType<typeof requestHint> | undefined;
  if (hits.length === 0) {
    const missBody: Record<string, string> = {};
    if (isFips) missBody.county_fips = query;
    else {
      if (stateFilter) missBody.state_slug = stateFilter.slug;
      if (name) missBody.county_slug = countySlugFromName(name);
    }
    request = requestHint(ctx, missBody);
  }
  const doc = {
    ok: true,
    found: hits.length > 0,
    ...dataStamp(),
    query,
    state_filter: stateFilter?.slug ?? null,
    total_matches: total,
    results: hits.map(hitDoc),
    ...(request ? { request } : {}),
  };
  emit(ctx, doc, () => {
    if (request) {
      const miss = isFips
        ? `No county with FIPS ${query} in the atlas. It may exist but not be indexed yet.`
        : `No county matches "${query}". Try a shorter name, add the state ("Kane IL"), or run \`uks states\`.`;
      return `${miss}\nRequest it (free): ${request.command}`;
    }
    const lines = [
      table(
        ["FIPS", "COUNTY", "STATE", "ENDPOINTS", "MATCH"],
        hits.map((h) => [h.county.countyFips ?? "-", countyDisplayName(h.county.county), h.county.state, String(h.county.endpoints.length), h.match]),
      ),
    ];
    if (total > hits.length) lines.push("", `${total} matches. Showing ${hits.length}. Use --limit to see more.`);
    lines.push("", `Details: ${hitDoc(hits[0]!).command}`);
    return lines.join("\n");
  });
  return EXIT.OK;
}

// ---------------------------------------------------------------- county

// Adapted from the monorepo's api/_lib/search-capability.ts, which the hosted
// MCP's get_county_endpoint uses. The shared-layer tail differs in wording
// ("neighboring", and the scope_where sentence); the meaning is the same. Keep in step.
const UNSUPPORTED_NOTE =
  "Text search on owner, address or parcel fields is unsupported on this layer: a table scan does not finish. Query it by geometry (a point with a distance, or an envelope); sample_query shows one request this layer answers.";
const UNSCOPED_UNSUPPORTED_TAIL = " Owner, address and parcel fields come back on every hit.";
const SHARED_UNSUPPORTED_TAIL =
  " The layer serves several counties, so a hit near the county line can belong to a neighboring county: scope_where names this county's rows. The scope_where column is not indexed on this layer, so check it on each hit rather than adding it to the query.";
const SUPPORTED_NOTE =
  "Typed search is supported on this layer's columns (see searchable_fields); geometry queries are supported too. This describes the layer's query model; status says whether the service is up.";
const SHARED_SUPPORTED_TAIL =
  " The layer serves several counties: AND scope_where into every where clause, or the results include other counties' parcels.";

function searchNote(ep: EndpointRecord): string {
  const shared = !!ep.scopeWhere;
  if (!offersAttributeSearch(ep)) return UNSUPPORTED_NOTE + (shared ? SHARED_UNSUPPORTED_TAIL : UNSCOPED_UNSUPPORTED_TAIL);
  return SUPPORTED_NOTE + (shared ? SHARED_SUPPORTED_TAIL : "");
}

/** The column holding the owner's name, when the layer documents one. */
export function ownerField(ep: EndpointRecord): { name: string; label: string } | null {
  const candidates = ep.searchFields.filter((f) => /owner|taxpayer/i.test(`${f.name} ${f.label}`));
  const best = candidates.find((f) => /name|nm\b/i.test(`${f.name} ${f.label}`)) ?? candidates[0];
  return best ? { name: best.name, label: best.label } : null;
}

function endpointDoc(c: CountyRecord, ep: EndpointRecord, deepLinkBase: string) {
  const searchable = offersAttributeSearch(ep);
  return {
    url: ep.url,
    service_type: ep.serviceType,
    layer_index: ep.layerIndex,
    layer_name: ep.layerName,
    status: ep.status,
    status_is_publish_time: true,
    last_verified: ep.lastVerified,
    license: ep.license,
    license_url: ep.licenseUrl,
    cors_enabled: ep.corsEnabled,
    owner_field: ownerField(ep),
    attribute_search: searchable ? "supported" : "unsupported",
    query_mode: searchable ? "attribute_or_spatial" : "spatial_only",
    scope_where: ep.scopeWhere ?? null,
    sample_query: ep.sampleQuery,
    search_note: searchNote(ep),
    searchable_fields: searchable ? ep.searchFields.map((f) => f.name) : [],
    fields: ep.searchFields.map((f) => ({ name: f.name, label: f.label })),
    urbankit_lookup_url: buildParcelLookupDeepLink(ep, deepLinkBase, c),
  };
}

function ownerSummary(c: CountyRecord) {
  const reviewed = reviewedCapability(c, "owner_name");
  const field = c.endpoints.map(ownerField).find((f) => f !== null) ?? null;
  const unservable = reviewed && (reviewed.status === "restricted" || reviewed.status === "not_published");
  let whyNone: string | null = null;
  if (unservable) whyNone = reviewed.basis.note;
  else if (!field) {
    whyNone =
      c.ownerFieldNote?.body ??
      (c.endpoints.length === 0 ? "This county publishes no public parcel REST endpoint." : "No owner column is documented in this layer's fields.");
  }
  return {
    field: unservable ? null : field,
    status: reviewed?.status ?? (field ? "field_documented" : "not_documented"),
    why_none: whyNone,
    basis: reviewed?.basis ?? null,
    lawful_alternative_url: reviewed?.lawfulAlternativeUrl ?? null,
    note: c.ownerFieldNote?.body ?? null,
  };
}

export function countyDoc(ctx: Context, c: CountyRecord) {
  const deepLinkBase = `${SITE}/tools/parcel-lookup`;
  return {
    ok: true,
    found: true,
    ...dataStamp(),
    state_slug: c.stateSlug,
    state_name: c.stateName,
    state_abbrev: c.state,
    county_name: countyDisplayName(c.county),
    county_slug: c.countySlug,
    county_fips: c.countyFips,
    has_public_rest: c.hasPublicRest,
    any_attribute_search: countyOffersAttributeSearch(c),
    owner: ownerSummary(c),
    endpoints: c.endpoints.map((ep) => endpointDoc(c, ep, deepLinkBase)),
    contact: c.contact,
    notes: c.notes,
    added_at: c.addedAt ?? null,
    data_vintage: c.dataVintage?.body ?? null,
    urbankit_county_page: `${SITE}/parcel-atlas/${c.stateSlug}/${c.countySlug}`,
    live_status_url: c.countyFips ? `${LIVE_STATUS_URL}?fips=${c.countyFips}` : LIVE_STATUS_URL,
    county: c,
  };
}

function renderCounty(doc: ReturnType<typeof countyDoc>): string {
  const lines = [
    `${doc.county_name}, ${doc.state_name} (FIPS ${doc.county_fips ?? "unknown"})`,
    `Public REST: ${doc.has_public_rest ? `yes, ${doc.endpoints.length} endpoint${doc.endpoints.length === 1 ? "" : "s"}` : "no"}`,
  ];
  doc.endpoints.forEach((ep, i) => {
    lines.push(
      "",
      `Endpoint ${i + 1}: ${ep.layer_name} (${ep.service_type}, layer ${ep.layer_index})`,
      fields([
        ["  URL", ep.url],
        ["  Status", `${ep.status}, verified ${ep.last_verified} (publish-time; live: ${doc.live_status_url})`],
        ["  Owner field", ep.owner_field ? `${ep.owner_field.name} (${ep.owner_field.label})` : "none documented"],
        ["  Search", ep.query_mode === "spatial_only" ? "spatial only (query by geometry)" : "attribute or spatial"],
        ["  Scope", ep.scope_where ? `${ep.scope_where} (shared layer)` : undefined],
        ["  Sample query", ep.sample_query ?? undefined],
        ["  Open in UrbanKit", ep.urbankit_lookup_url],
      ]),
    );
    if (ep.scope_where || ep.query_mode === "spatial_only") lines.push(`  ${ep.search_note}`);
  });
  lines.push("");
  if (doc.owner.why_none) lines.push(`Owner data: ${doc.owner.why_none}`);
  if (doc.owner.note && doc.owner.note !== doc.owner.why_none) lines.push(`Owner note: ${doc.owner.note}`);
  if (doc.data_vintage) lines.push(`Data vintage: ${doc.data_vintage}`);
  if (doc.notes) lines.push(`Notes: ${doc.notes}`);
  lines.push(`County page: ${doc.urbankit_county_page}`);
  return lines.join("\n");
}

function resolveState(input: string): StateIndexEntry {
  const state = stateByToken(input);
  if (!state) throw usageError(`'${input}' is not a US state. Use a slug ("illinois"), a name or a two-letter code; \`uks states\` lists them.`);
  return state;
}

export async function countyCommand(ctx: Context, positionals: string[]): Promise<number> {
  let record: CountyRecord | undefined;
  let missBody: Record<string, string>;
  let missText: string;
  if (positionals.length === 1 && /^\d{5}$/.test(positionals[0]!)) {
    const fips = positionals[0]!;
    record = findCountyByFips(fips);
    missBody = { county_fips: fips };
    missText = `County with FIPS '${fips}' is not in the UrbanKit atlas. The county may exist but not yet be indexed.`;
  } else if (positionals.length === 2) {
    const state = resolveState(positionals[0]!);
    const raw = positionals[1]!.trim();
    if (!raw) throw usageError("county needs a county name or slug.");
    const slug = countySlugFromName(raw);
    record = findCounty(state.slug, slugify(raw)) ?? findCounty(state.slug, slug);
    missBody = { state_slug: state.slug, county_slug: slug };
    missText = `County '${slug}' not found in '${state.slug}'. Run \`uks find "${raw} ${state.abbrev}"\` for close matches; if it is missing there, it is not indexed yet.`;
  } else {
    throw usageError("Usage: uks county <state> <county>  (or: uks county <5-digit FIPS>)");
  }

  if (!record) {
    const request = requestHint(ctx, missBody);
    const doc = { ok: true, found: false, ...dataStamp(), ...missBody, message: missText, request };
    emit(ctx, doc, () => `${missText}\nRequest it (free): ${request.command}`);
    return EXIT.OK;
  }
  const doc = countyDoc(ctx, record);
  emit(ctx, doc, () => renderCounty(doc));
  return EXIT.OK;
}
