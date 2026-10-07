// Offline commands against the real @urbankitstudio/atlas data. Every call uses
// the default fetch from helpers.ts, which throws: none of these may touch the network.
import { atlasIndex } from "@urbankitstudio/atlas";
import { describe, expect, it } from "vitest";
import { findCounties } from "../src/commands/offline.js";
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
    const human = await uks(["find", "Zzyzxville"]);
    expect(human.stdout).toContain('No county matches "Zzyzxville"');
    expect(human.stdout).toContain("Request it (free): uks request-county --state <state-slug> --county zzyzxville-county");
  });

  it("a name miss with a state: a complete request body, matching `county`", async () => {
    const doc = (await uks(["find", "Zzyzxville MI", "--json"])).json();
    expect(doc.found).toBe(false);
    expect(doc.request.body).toEqual({ state_slug: "michigan", county_slug: "zzyzxville-county" });
    expect(doc.request).not.toHaveProperty("missing");
    expect(doc.request.command).toBe("uks request-county --state michigan --county zzyzxville-county");
  });

  it("an unindexed FIPS: found false and the request hint", async () => {
    const r = await uks(["find", "26031", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.found).toBe(false);
    expect(doc.results).toEqual([]);
    expect(doc.request.body).toEqual({ county_fips: "26031" });
    expect(doc.request.command).toBe("uks request-county --fips 26031");
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
    expect(human.stdout).toContain("uks request-county --state michigan --county cheboygan-county");
  });

  it("an unknown state or wrong arity exits 2", async () => {
    expect((await uks(["county", "atlantis", "kane-county"])).code).toBe(2);
    expect((await uks(["county", "illinois"])).code).toBe(2);
    expect((await uks(["county"])).code).toBe(2);
  });
});
