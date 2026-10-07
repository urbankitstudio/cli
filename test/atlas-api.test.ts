import { describe, expect, it } from "vitest";
import { buildCountyRequest } from "../src/commands/atlas-api.js";
import { fakeFetch, KEY, networkError, uks } from "./helpers.js";
import {
  ACCOUNT_429,
  LOOKUP_MATCHED,
  LOOKUP_NO_GEOCODE,
  LOOKUP_NOT_INDEXED,
  LOOKUP_QUOTA_429,
  REQUEST_BUDGET_429,
} from "./fixtures.js";

describe("lookup", () => {
  it("keyless: GET /api/atlas/lookup?address=..., no Authorization header", async () => {
    const f = fakeFetch({ body: LOOKUP_MATCHED });
    const r = await uks(["lookup", "100 S 3rd St, Geneva, IL"], { fetch: f.fetch });
    expect(r.code).toBe(0);
    expect(f.calls[0]!.method).toBe("GET");
    expect(f.calls[0]!.url.pathname).toBe("/api/atlas/lookup");
    expect(f.calls[0]!.url.searchParams.get("address")).toBe("100 S 3rd St, Geneva, IL");
    expect(f.calls[0]!.headers.authorization).toBeUndefined();
  });

  it("joins unquoted words into one address", async () => {
    const f = fakeFetch({ body: LOOKUP_MATCHED });
    await uks(["lookup", "100", "S", "3rd", "St,", "Geneva,", "IL"], { fetch: f.fetch });
    expect(f.calls[0]!.url.searchParams.get("address")).toBe("100 S 3rd St, Geneva, IL");
  });

  it("sends the key when there is one", async () => {
    const f = fakeFetch({ body: LOOKUP_MATCHED });
    await uks(["lookup", "100 S 3rd St, Geneva, IL"], { fetch: f.fetch, env: { UKS_API_KEY: KEY } });
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("human output for a match: county, endpoint, rate limit", async () => {
    const r = await uks(["lookup", "100 S 3rd St, Geneva, IL"], { fetch: fakeFetch({ body: LOOKUP_MATCHED }).fetch });
    expect(r.stdout).toMatch(/County:\s+Kane, IL \(FIPS 17089\)/);
    expect(r.stdout).toContain("https://gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0");
    expect(r.stdout).toContain("County page: https://urbankitstudio.com/parcel-atlas/illinois/kane-county");
    expect(r.stdout).toContain("Rate limit: 4 of 5 left");
  });

  it("--json prints the server document", async () => {
    const r = await uks(["lookup", "100 S 3rd St, Geneva, IL", "--json"], { fetch: fakeFetch({ body: LOOKUP_MATCHED }).fetch });
    expect(r.json()).toEqual(LOOKUP_MATCHED);
  });

  it("not indexed: exit 0 and the request-county command", async () => {
    const r = await uks(["lookup", "1 Main St, Cheboygan, MI"], { fetch: fakeFetch({ body: LOOKUP_NOT_INDEXED }).fetch });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("is not in the UrbanKit atlas yet");
    expect(r.stdout).toContain("uks request-county --fips 26031");
  });

  it("no geocode match is exit 0, not an error", async () => {
    const r = await uks(["lookup", "not an address"], { fetch: fakeFetch({ body: LOOKUP_NO_GEOCODE }).fetch });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No match.");
  });

  it("quota 429 (rate_limited) exits 3 with the server message, body reset and upgrade_url", async () => {
    const r = await uks(["lookup", "100 S 3rd St, Geneva, IL", "--json"], { fetch: fakeFetch(LOOKUP_QUOTA_429).fetch });
    expect(r.code).toBe(3);
    expect(r.stderr).toBe(
      "uks: Daily limit reached (free tier — 500 requests/day). Upgrade for a higher limit. Resets at 2026-10-07T00:00:00.000Z. Upgrade: https://urbankitstudio.com/enterprise\n",
    );
    expect(r.json()).toMatchObject({
      error: "rate_limited",
      exit_code: 3,
      reset_at: "2026-10-07T00:00:00.000Z",
      limit: 500,
      remaining: 0,
      upgrade_url: "https://urbankitstudio.com/enterprise",
    });
  });

  it("geocoder 504 exits 2", async () => {
    const r = await uks(["lookup", "100 S 3rd St, Geneva, IL"], {
      fetch: fakeFetch({ status: 504, body: { ok: false, error: "geocode-unavailable", message: "Retry shortly." } }).fetch,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("HTTP 504");
  });

  it("a missing address exits 2 without a request", async () => {
    const f = fakeFetch({ body: LOOKUP_MATCHED });
    const r = await uks(["lookup"], { fetch: f.fetch });
    expect(r.code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });
});

describe("request-county", () => {
  it("POSTs county_fips plus the optional fields, with no key even when one is set", async () => {
    const f = fakeFetch({ status: 202, body: { accepted: true, id: "8e1f2a3b-0000-4000-8000-000000000001" } });
    const r = await uks(
      ["request-county", "--fips", "06003", "--email", "me@example.com", "--note", "please", "--source-url", "https://gis.alpine.ca.us/"],
      { fetch: f.fetch, env: { UKS_API_KEY: KEY } },
    );
    expect(r.code).toBe(0);
    const call = f.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/api/atlas/request");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers.authorization).toBeUndefined();
    expect(JSON.parse(call.body!)).toEqual({
      county_fips: "06003",
      requester_email: "me@example.com",
      note: "please",
      source_url: "https://gis.alpine.ca.us/",
    });
    expect(r.stdout).toContain("accepted (id 8e1f2a3b-0000-4000-8000-000000000001)");
    expect(r.stdout).toContain("within 24 hours returns the same id");
    expect(r.stdout).not.toContain("decide which counties");
  });

  it("by slugs", async () => {
    const f = fakeFetch({ status: 202, body: { accepted: true, id: "x" } });
    const r = await uks(["request-county", "--state", "michigan", "--county", "cheboygan-county", "--json"], { fetch: f.fetch });
    expect(r.code).toBe(0);
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ state_slug: "michigan", county_slug: "cheboygan-county" });
    expect(r.json()).toEqual({ accepted: true, id: "x" });
  });

  it.each([
    [[], "needs --fips"],
    [["--fips", "6003"], "5 digits"],
    [["--fips", "06003", "--state", "california"], "not both"],
    [["--state", "michigan"], "go together"],
    [["--state", "Michigan", "--county", "cheboygan-county"], "lowercase slug"],
    [["--state", "michigan", "--county", "cheboygan--county"], "single hyphens"],
    [["--state", "michigan", "--county", "cheboygan_county"], "lowercase slug"],
    [["--fips", "06003", "--email", "not-an-email"], "--email"],
    [["--fips", "06003", "--source-url", "http://insecure.example.com"], "https://"],
    [["--fips", "06003", "--note", "x".repeat(1001)], "1000 characters"],
  ])("rejects %j with exit 2 before any request", async (args, message) => {
    const f = fakeFetch({ status: 202, body: { accepted: true } });
    const r = await uks(["request-county", ...args], { fetch: f.fetch });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(message);
    expect(f.calls).toHaveLength(0);
  });

  it("429 request-budget exits 3 with the server message and no upgrade link", async () => {
    const r = await uks(["request-county", "--fips", "06003", "--json"], { fetch: fakeFetch(REQUEST_BUDGET_429).fetch });
    expect(r.code).toBe(3);
    expect(r.stderr).toBe(
      "uks: The daily budget for county requests has been reached. The request was not stored. Try again later. Resets at 2026-10-06T13:00:00.000Z.\n",
    );
    expect(r.json()).toMatchObject({ error: "request-budget", exit_code: 3, retry_after_seconds: 3600 });
    expect(r.json()).not.toHaveProperty("upgrade_url");
  });

  it("429 from the per-IP limiter (rate-limited) exits 3 with the server message", async () => {
    const r = await uks(["request-county", "--fips", "06003"], { fetch: fakeFetch(ACCOUNT_429).fetch });
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("uks: Too many requests. Retry in 42s. Resets at 2026-10-06T14:00:42.000Z.\n");
  });

  it("503 exits 2; a network failure exits 2", async () => {
    const a = await uks(["request-county", "--fips", "06003"], { fetch: fakeFetch({ status: 503, body: { ok: false, error: "store-unavailable" } }).fetch });
    expect(a.code).toBe(2);
    const b = await uks(["request-county", "--fips", "06003"], { fetch: fakeFetch({ throws: networkError("ENOTFOUND") }).fetch });
    expect(b.code).toBe(2);
    expect(b.stderr).toContain("ENOTFOUND");
  });

  it("buildCountyRequest matches the CountyRequest schema's slug pattern", () => {
    expect(buildCountyRequest({ state: "new-york", county: "kings-county" })).toEqual({ state_slug: "new-york", county_slug: "kings-county" });
    expect(() => buildCountyRequest({ state: "-new-york", county: "kings-county" })).toThrow();
    expect(() => buildCountyRequest({ state: "new-york-", county: "kings-county" })).toThrow();
  });
});
