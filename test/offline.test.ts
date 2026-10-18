// Offline commands against the real @urbankitstudio/atlas data. Every call uses
// the default fetch from helpers.ts, which throws: none of these may touch the network.
import { atlasIndex, findCountyByFips, type CountyRecord, type EndpointRecord } from "@urbankitstudio/atlas";
import { describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { countyDoc, findCounties, paginationLine, paginationTail, renderCounty } from "../src/commands/offline.js";
import { COUNTY_RECHECK_REQUEST_MESSAGE, COUNTY_REQUEST_MESSAGE, NOT_IN_ATLAS_WHY } from "../src/coverage-core.js";
import { uks } from "./helpers.js";

describe("states", () => {
  it("--json lists every populated state with counts", async () => {
    const r = await uks(["states", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.ok).toBe(true);
    expect(doc.states.length).toBe(atlasIndex.states.filter((s) => s.populated).length);
    expect(doc.states).toContainEqual(expect.objectContaining({ slug: "illinois", name: "Illinois", abbrev: "IL" }));
    expect(doc.totals).toEqual(atlasIndex.totals);
    expect(doc.data_last_updated).toBe(atlasIndex.lastUpdated);
  });

  it("human output is a table and a totals line", async () => {
    const r = await uks(["states"]);
    expect(r.stdout.split("\n")[0]).toMatch(/^STATE\s+ABBR\s+SLUG\s+COUNTIES\s+ENDPOINTS$/);
    expect(r.stdout).toMatch(/Illinois\s+IL\s+illinois/);
    expect(r.stdout).toContain(`${atlasIndex.totals.counties} counties`);
  });
});

describe("find", () => {
  it('"Kane IL" finds Kane County, Illinois first', async () => {
    const r = await uks(["find", "Kane IL", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.state_filter).toBe("illinois");
    expect(doc.results[0]).toMatchObject({
      county_name: "Kane County",
      county_fips: "17089",
      state_slug: "illinois",
      county_slug: "kane-county",
      match: "exact",
      command: "uks county illinois kane-county",
    });
  });

  it.each(["Kane County, Illinois", "kane county il", "17089", "Kane"])("%s also finds Kane IL", (q) => {
    const { hits } = findCounties(q);
    expect(hits.map((h) => h.county.countyFips)).toContain("17089");
  });

  it("a near spelling is a fuzzy match", () => {
    const { hits } = findCounties("Kanee IL");
    expect(hits[0]?.county.countyFips).toBe("17089");
    expect(hits[0]?.match).toBe("fuzzy");
  });

  it("a name shared across states lists each, and --limit caps them", async () => {
    const all = findCounties("Hamilton");
    expect(all.total).toBeGreaterThan(1);
    expect(new Set(all.hits.map((h) => h.county.stateSlug)).size).toBe(all.total);
    const r = await uks(["find", "Hamilton", "--limit", "1", "--json"]);
    expect(r.json().results).toHaveLength(1);
    expect(r.json().total_matches).toBe(all.total);
  });

  it("a state alone lists that state's counties", () => {
    const { hits, stateFilter } = findCounties("Illinois");
    expect(stateFilter?.slug).toBe("illinois");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.county.stateSlug === "illinois")).toBe(true);
  });

  it("a hit says found: true and carries no request hint", async () => {
    const doc = (await uks(["find", "Kane IL", "--json"])).json();
    expect(doc.found).toBe(true);
    expect(doc).not.toHaveProperty("request");
  });

  it("a name miss without a state: found false, exit 0, a request hint naming the missing state", async () => {
    const r = await uks(["find", "Zzyzxville", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.found).toBe(false);
    expect(doc.results).toEqual([]);
    expect(doc.request.body).toEqual({ county_slug: "zzyzxville-county" });
    expect(doc.request.missing).toEqual(["state_slug"]);
    expect(doc.request.command).toBe("uks request-county --state <state-slug> --county zzyzxville-county");
    // The text says to check the spelling, and with no complete body it names the FIPS route.
    expect(doc.coverage.message).toContain("Check the spelling first");
    expect(doc.coverage.message).toContain("`uks request-county --fips <5 digits>`");
    const human = await uks(["find", "Zzyzxville"]);
    expect(human.stdout).toContain(`No county matches "Zzyzxville". Try a shorter name, add the state ("Kane IL"), or run \`uks states\`.\n${doc.coverage.message}`);
  });

  it("a name miss with a state: a complete request body, matching `county`", async () => {
    const doc = (await uks(["find", "Zzyzxville MI", "--json"])).json();
    expect(doc.found).toBe(false);
    expect(doc.request.body).toEqual({ state_slug: "michigan", county_slug: "zzyzxville-county" });
    expect(doc.request).not.toHaveProperty("missing");
    expect(doc.request.command).toBe("uks request-county --state michigan --county zzyzxville-county");
    const county = (await uks(["county", "michigan", "Zzyzxville", "--json"])).json();
    expect(county.request.body).toEqual(doc.request.body);
    const human = await uks(["find", "Zzyzxville MI"]);
    expect(human.stdout).toContain("Check the spelling first");
    expect(human.stdout).toContain("`uks request-county --state michigan --county zzyzxville-county`");
  });

  it("an unindexed FIPS: found false and the request hint", async () => {
    const r = await uks(["find", "26031", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.found).toBe(false);
    expect(doc.results).toEqual([]);
    expect(doc.request.body).toEqual({ county_fips: "26031", state_abbrev: "MI" });
    expect(doc.request.command).toBe("uks request-county --fips 26031");
    // A FIPS code cannot be misspelled into another county's name: no spelling line.
    const human = await uks(["find", "26031"]);
    expect(human.stdout).toContain(doc.coverage.message);
    expect(human.stdout).not.toContain("Check the spelling");
  });

  it("no query exits 2; a bad --limit exits 2", async () => {
    expect((await uks(["find"])).code).toBe(2);
    expect((await uks(["find", "Kane", "--limit", "0"])).code).toBe(2);
  });
});

describe("county", () => {
  it("Kane IL: endpoint, owner field, deep link, county page", async () => {
    const r = await uks(["county", "illinois", "kane-county", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc).toMatchObject({
      ok: true,
      found: true,
      state_slug: "illinois",
      county_slug: "kane-county",
      county_fips: "17089",
      has_public_rest: true,
      urbankit_county_page: "https://urbankitstudio.com/parcel-atlas/illinois/kane-county",
      live_status_url: "https://urbankitstudio.com/api/atlas/status?fips=17089",
    });
    const ep = doc.endpoints[0];
    expect(ep.url).toBe("https://gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0");
    expect(ep.layer_index).toBe(0);
    expect(ep.owner_field).toEqual({ name: "TaxName", label: "Taxpayer Name" });
    expect(ep.scope_where).toBeNull();
    expect(ep.query_mode).toBe("attribute_or_spatial");
    expect(ep.urbankit_lookup_url).toMatch(/^https:\/\/urbankitstudio\.com\/tools\/parcel-lookup\?endpoint=/);
    expect(doc.owner.why_none).toBeNull();
    expect(doc.county.countyFips).toBe("17089");
  });

  it("accepts a state code and a bare county name, or a FIPS", async () => {
    const a = (await uks(["county", "IL", "Kane", "--json"])).json();
    const b = (await uks(["county", "Illinois", "Kane County", "--json"])).json();
    const c = (await uks(["county", "17089", "--json"])).json();
    expect(a.county_fips).toBe("17089");
    expect(b.county_fips).toBe("17089");
    expect(c.county_fips).toBe("17089");
  });

  it("human output", async () => {
    const r = await uks(["county", "illinois", "kane-county"]);
    expect(r.stdout.split("\n")[0]).toBe("Kane County, Illinois (FIPS 17089)");
    expect(r.stdout).toMatch(/URL:\s+https:\/\/gistech\.countyofkane\.org/);
    expect(r.stdout).toMatch(/Owner field:\s+TaxName \(Taxpayer Name\)/);
    expect(r.stdout).toContain("County page: https://urbankitstudio.com/parcel-atlas/illinois/kane-county");
  });

  it("a shared, spatial-only layer carries its scope predicate and note (Alachua FL)", async () => {
    const doc = (await uks(["county", "florida", "alachua-county", "--json"])).json();
    const ep = doc.endpoints[0];
    expect(ep.scope_where).toBe("CO_NO=11");
    expect(ep.query_mode).toBe("spatial_only");
    expect(ep.searchable_fields).toEqual([]);
    expect(ep.search_note).toContain("scope_where names this county's rows");
    expect(ep.urbankit_lookup_url).toBe("https://urbankitstudio.com/tools/parcel-lookup/florida/alachua-county");
  });

  it("a reviewed restriction explains why there is no owner data (San Bernardino CA)", async () => {
    const doc = (await uks(["county", "california", "san-bernardino-county", "--json"])).json();
    expect(doc.owner.status).toBe("restricted");
    expect(doc.owner.field).toBeNull();
    expect(doc.owner.why_none).toContain("Protected Per CA Gov Code 7928.205");
  });

  it("a layer with no owner column: the reviewed record explains it and the county note travels too (Mendocino CA)", async () => {
    const doc = (await uks(["county", "06045", "--json"])).json();
    expect(doc.owner.status).toBe("not_published");
    expect(doc.owner.field).toBeNull();
    expect(doc.owner.why_none).toContain("no owner-name column");
    expect(doc.owner.note).toContain("publishes no owner name");
  });

  it("a county with no public endpoint (Hillsborough NH)", async () => {
    const doc = (await uks(["county", "new-hampshire", "hillsborough-county", "--json"])).json();
    expect(doc.has_public_rest).toBe(false);
    expect(doc.endpoints).toEqual([]);
    expect(doc.owner.why_none).toBeTruthy();
  });

  it("a county not in the atlas: found false, exit 0, request hint by slug", async () => {
    const r = await uks(["county", "michigan", "cheboygan-county", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.found).toBe(false);
    expect(doc.request.body).toEqual({ state_slug: "michigan", county_slug: "cheboygan-county" });
    expect(doc.request.command).toBe("uks request-county --state michigan --county cheboygan-county");
    const human = await uks(["county", "michigan", "Cheboygan"]);
    expect(human.stdout).toContain("`uks request-county --state michigan --county cheboygan-county`");
    expect(human.stdout).toContain(`{"state_slug":"michigan","county_slug":"cheboygan-county"}`);
  });

  it("an unknown state or wrong arity exits 2", async () => {
    expect((await uks(["county", "atlantis", "kane-county"])).code).toBe(2);
    expect((await uks(["county", "illinois"])).code).toBe(2);
    expect((await uks(["county"])).code).toBe(2);
  });

  it("every endpoint in the bundled data pages today: pagination 'supported', max_record_count null, no Pagination row", async () => {
    const doc = (await uks(["county", "illinois", "kane-county", "--json"])).json();
    expect(doc.endpoints[0]).toMatchObject({ pagination: "supported", max_record_count: null });
    expect(doc.endpoints[0].search_note).not.toContain("refuses resultRecordCount");
    expect((await uks(["county", "illinois", "kane-county"])).stdout).not.toContain("Pagination:");
  });
});

/**
 * A layer flagged `supportsPagination: false` (the Mississippi statewide layers
 * from @urbankitstudio/atlas 0.6.30; the bundled data this test runs against may
 * predate them, so the record is Kane's with the two keys added). The CLI reads
 * the keys structurally, documents them, and tells the agent how to query.
 */
describe("county on a layer that refuses pagination", () => {
  const ctx = { json: true, quiet: false, apiBase: "https://urbankitstudio.com" } as Context;
  const kane = findCountyByFips("17089")!;
  const flag = (ep: EndpointRecord, cap: number | null) => ({ ...ep, supportsPagination: false, maxRecordCount: cap }) as EndpointRecord;
  const flagged: CountyRecord = { ...kane, endpoints: [flag(kane.endpoints[0]!, 2000)] };

  it("--json documents pagination 'unsupported', the cap, and the hosted search_note tail", () => {
    const doc = countyDoc(ctx, flagged);
    const ep = doc.endpoints[0]!;
    expect(ep.pagination).toBe("unsupported");
    expect(ep.max_record_count).toBe(2000);
    expect(ep.attribute_search).toBe("supported"); // the flag is about paging, not about where clauses
    expect(ep.search_note).toBe(
      "Typed search is supported on this layer's columns (see searchable_fields); geometry queries are supported too. This describes the layer's query model; status says whether the service is up." +
        " This layer refuses resultRecordCount and resultOffset (no pagination): send one request without them." +
        " It returns at most 2,000 rows and sets exceededTransferLimit when more match, so narrow the where clause or the geometry instead of paging." +
        " Queries other than by FID (the object id) scan the whole layer (1.5 to 20 s); returnDistinctValues and orderByFields are silently ignored, and outStatistics fails.",
    );
  });

  it("human output carries a Pagination row and the note, which the paging control does not", () => {
    const text = renderCounty(countyDoc(ctx, flagged));
    expect(text).toMatch(/Pagination:\s+none: one request returns at most 2,000 rows; send no resultRecordCount or resultOffset/);
    expect(text).toContain("  Typed search is supported on this layer's columns");
    expect(text).toContain("This layer refuses resultRecordCount and resultOffset");
    expect(renderCounty(countyDoc(ctx, kane))).not.toContain("Pagination:");
  });

  it("a flagged record without a cap says so instead of inventing a number", () => {
    const noCap: CountyRecord = { ...kane, endpoints: [flag(kane.endpoints[0]!, null)] };
    const ep = countyDoc(ctx, noCap).endpoints[0]!;
    expect(ep.max_record_count).toBeNull();
    expect(ep.search_note).toContain("It returns at most its declared maximum of rows");
    expect(paginationLine("unsupported", null)).toBe("none: one request returns at most the layer's cap; send no resultRecordCount or resultOffset");
    expect(paginationLine("supported", 2000)).toBeUndefined();
    expect(paginationLine(undefined, undefined)).toBeUndefined();
  });

  it("only the literal false flags a layer", () => {
    // Off-type on purpose: atlas 0.6.30 types the key as `false | undefined`, and the reader must
    // still treat anything else as "pages".
    expect(paginationTail({ ...kane.endpoints[0]!, supportsPagination: true } as unknown as EndpointRecord)).toBe("");
    expect(paginationTail({ ...kane.endpoints[0]!, supportsPagination: null } as unknown as EndpointRecord)).toBe("");
    expect(paginationTail(kane.endpoints[0]!)).toBe("");
    expect(paginationTail(flag(kane.endpoints[0]!, 2000))).toMatch(/^ This layer refuses/);
  });
});

/**
 * A county we do not serve gets the shared coverage block (coverage-core.ts): why,
 * the county office, the county's own product, and the request, which is the same
 * object as the top-level `request` and carries the CLI's `command`. The record is
 * Kane's reshaped, because the bundled data this test runs against may predate the
 * `coverage` field.
 */
describe("coverage for a county we do not serve", () => {
  const ctx = { json: true, quiet: false, apiBase: "https://urbankitstudio.com" } as Context;
  const kane = findCountyByFips("17089")!;
  const sold = {
    ...kane,
    hasPublicRest: false,
    endpoints: [],
    contact: { department: "GIS Division", url: "https://example.gov/gis", email: null },
    coverage: {
      reason: "owner-data-sold",
      summary: "The county sells parcel data with owner names, so we don't index it.",
      checked: "2026-10-17",
      recheck: "2026-10-24",
      countyProduct: { name: "County Data Hub", url: "https://example.gov/data" },
    },
  } as unknown as CountyRecord;

  it("--json: the coverage block, its request equal to the top-level one, and the shared recheck message", () => {
    const doc = countyDoc(ctx, sold);
    expect(doc.coverage).toMatchObject({
      indexed: false,
      status: "no-public-data",
      reason: "owner-data-sold",
      why: "The county sells parcel data with owner names, so we don't index it.",
      checked: "2026-10-17",
      recheck: "2026-10-24",
      county_office: { department: "GIS Division", url: "https://example.gov/gis" },
      county_product: { name: "County Data Hub", url: "https://example.gov/data" },
    });
    expect(doc.request).toBe(doc.coverage!.request);
    expect(doc.request!.message).toBe(COUNTY_RECHECK_REQUEST_MESSAGE);
    expect(doc.request!.command).toBe("uks request-county --fips 17089");
    expect(doc.request!.body).toEqual({ county_fips: "17089", county_name: "Kane", state_abbrev: "IL" });
  });

  it("human output prints the block's text verbatim: why, the dates, the office, the product and the request line", () => {
    const doc = countyDoc(ctx, sold);
    const text = renderCounty(doc);
    expect(text).toContain(doc.coverage!.message);
    expect(doc.coverage!.message.split("\n")).toEqual([
      "The county sells parcel data with owner names, so we don't index it.",
      "Checked: 2026-10-17",
      "Next check: 2026-10-24",
      "County office: GIS Division, https://example.gov/gis",
      "County product: County Data Hub, https://example.gov/data",
      "We recheck counties like this one. A request tells us people want it, but it does not promise we will add it.",
      expect.stringContaining("`uks request-county --fips 17089`"),
    ]);
  });

  it("CONTROL: a served county carries no coverage block and prints no request line", () => {
    const doc = countyDoc(ctx, kane);
    expect(doc).not.toHaveProperty("coverage");
    expect(doc).not.toHaveProperty("request");
    expect(renderCounty(doc)).not.toContain("request-county");
  });

  it("the bundled no-endpoint county (Hillsborough NH) gets the block too", async () => {
    const doc = (await uks(["county", "new-hampshire", "hillsborough-county", "--json"])).json();
    expect(doc.coverage).toMatchObject({ indexed: false, status: "no-public-data" });
    expect(doc.request).toEqual(doc.coverage.request);
    expect(doc.request.message).toBe(COUNTY_RECHECK_REQUEST_MESSAGE);
  });

  it("a miss carries the not-in-atlas block and the shared request message", async () => {
    const doc = (await uks(["county", "michigan", "cheboygan-county", "--json"])).json();
    expect(doc.coverage).toMatchObject({ indexed: false, status: "not-in-atlas", reason: null, why: NOT_IN_ATLAS_WHY });
    expect(doc.request).toEqual(doc.coverage.request);
    expect(doc.request.message).toBe(COUNTY_REQUEST_MESSAGE);
    const find = (await uks(["find", "26031", "--json"])).json();
    expect(find.coverage.status).toBe("not-in-atlas");
    expect(find.request).toEqual(find.coverage.request);
  });
});
