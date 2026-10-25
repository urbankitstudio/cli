// The publisher's required statement (a record's `credit`) travels with what the
// CLI prints for that source: `uks lookup`, human and --json, and `uks county`,
// human and --json. One table over every output x {a credited source, the
// controls}. The records are Kane's reshaped, because the bundled data this test
// runs against may predate the field (it arrives with @urbankitstudio/atlas
// 0.6.42); the statement is Springfield's shape, long and full of commas.
import { findCountyByFips, type CountyRecord } from "@urbankitstudio/atlas";
import { describe, expect, it } from "vitest";
import type { Context } from "../src/context.js";
import { countyDoc, renderCounty } from "../src/commands/offline.js";
import { fakeFetch, uks } from "./helpers.js";
import { LOOKUP_MATCHED } from "./fixtures.js";

const CREDIT =
  "The City of Springfield makes no warranty, representation, or guaranty as to the content, accuracy, timeliness, or completeness of any of the information provided herein; the user assumes all risk.";

// Berks County's required sentence (clause 4 of its data agreement, R5): short, one period, no comma.
const BERKS_CREDIT = "Information is based on geospatial data from the County of Berks.";

const kane = findCountyByFips("17089")!;
const CASES = [
  { name: "a credited source", record: { ...kane, credit: CREDIT } as unknown as CountyRecord, credit: CREDIT },
  { name: "Berks' sentence", record: { ...kane, credit: BERKS_CREDIT } as unknown as CountyRecord, credit: BERKS_CREDIT },
  { name: "CONTROL, no credit", record: kane, credit: null },
  { name: "CONTROL, an empty credit", record: { ...kane, credit: "" } as unknown as CountyRecord, credit: null },
];
const ctx = { json: true, quiet: false, apiBase: "https://urbankitstudio.com" } as Context;
/** The server's answer for this record: its credit key as the record has it (absent, empty or set). */
const lookupBody = (record: CountyRecord) => ({
  ...LOOKUP_MATCHED,
  county: { ...LOOKUP_MATCHED.county, ...("credit" in record ? { credit: (record as { credit?: string }).credit } : {}) },
});
const ADDRESS = "100 S 3rd St, Geneva, IL";

/** What one output carried: the endpoint (so the row proves something was served) and the statement. */
const OUTPUTS: Array<{ output: string; run: (record: CountyRecord) => Promise<{ endpoint: boolean; credit: string | null }> }> = [
  {
    output: "uks lookup (human)",
    run: async (record) => {
      const out = (await uks(["lookup", ADDRESS], { fetch: fakeFetch({ body: lookupBody(record) }).fetch })).stdout;
      return { endpoint: out.includes(kane.endpoints[0]!.url), credit: /^Data credit: (.*)$/m.exec(out)?.[1] ?? null };
    },
  },
  {
    output: "uks lookup --json",
    run: async (record) => {
      const doc = (await uks(["lookup", ADDRESS, "--json"], { fetch: fakeFetch({ body: lookupBody(record) }).fetch })).json();
      return { endpoint: doc.county.endpoints.length > 0, credit: doc.county.credit ?? null };
    },
  },
  {
    output: "uks county --json",
    run: async (record) => {
      const doc = countyDoc(ctx, record);
      return { endpoint: doc.endpoints.length > 0, credit: doc.credit };
    },
  },
  {
    output: "uks county (human)",
    run: async (record) => {
      const out = renderCounty(countyDoc(ctx, record));
      return { endpoint: out.includes(kane.endpoints[0]!.url), credit: /^Data credit: (.*)$/m.exec(out)?.[1] ?? null };
    },
  },
];

describe("the record's credit, in every CLI output that serves its source", () => {
  const rows = OUTPUTS.flatMap((o) => CASES.map((k) => ({ ...o, ...k, label: `${o.output} x ${k.name}` })));
  it.each(rows)("$label", async ({ run, record, credit }) => {
    const served = await run(record);
    expect(served.endpoint).toBe(true);
    // --json passes the server's document through, so an empty statement arrives as "": nothing to show either way.
    expect(served.credit || null).toBe(credit);
  });
});
