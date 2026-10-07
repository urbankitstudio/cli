import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeFetch, uks } from "./helpers.js";
import { PLANS } from "./fixtures.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const atlasPkg = JSON.parse(
  readFileSync(new URL("../node_modules/@urbankitstudio/atlas/package.json", import.meta.url), "utf8"),
) as { version: string };

describe("help", () => {
  it("prints the command list with no arguments, exit 0", async () => {
    const r = await uks([]);
    expect(r.code).toBe(0);
    for (const c of ["plans", "whoami", "usage", "states", "find", "county", "lookup", "request-county", "login", "logout"]) {
      expect(r.stdout).toContain(`  ${c}`);
    }
    expect(r.stdout).toContain("Exit codes:");
  });

  it("--help and `help` print the same main help", async () => {
    const a = await uks(["--help"]);
    const b = await uks(["help"]);
    expect(a.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
  });

  it("<command> --help prints that command's usage and touches nothing", async () => {
    const r = await uks(["request-county", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: uks request-county");
    expect(r.stdout).toContain("within 24 hours returns the first request's id");
    expect(r.stdout).toContain("lowercase a-z and 0-9 with single hyphens");
  });

  it("help <command> matches <command> --help", async () => {
    const a = await uks(["help", "find"]);
    const b = await uks(["find", "--help"]);
    expect(a.stdout).toBe(b.stdout);
  });
});

describe("--version", () => {
  it("prints the CLI version and the atlas data version", async () => {
    const r = await uks(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`uks ${pkg.version}`);
    expect(r.stdout).toContain(`atlas ${atlasPkg.version}`);
  });

  it("--version --json is one JSON document", async () => {
    const r = await uks(["--version", "--json"]);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(doc.cli).toBe(pkg.version);
    expect(doc.atlas_package).toBe(atlasPkg.version);
    expect(doc.atlas_data.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.atlas_data.totals.counties).toBeGreaterThan(200);
  });
});

describe("argument errors exit 2", () => {
  it("unknown command", async () => {
    const r = await uks(["frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown command 'frobnicate'");
    expect(r.stdout).toBe("");
  });

  it("unknown option", async () => {
    const r = await uks(["plans", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^uks: .*bogus/);
  });

  it("an option that belongs to another command", async () => {
    const r = await uks(["plans", "--fips", "17089"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("'plans' does not take --fips");
  });

  it("stray positional arguments", async () => {
    const r = await uks(["whoami", "extra"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("takes no arguments");
  });

  it("a string option without its value", async () => {
    const r = await uks(["usage", "--from"]);
    expect(r.code).toBe(2);
  });

  it("with --json the error is a JSON document on stdout and a line on stderr", async () => {
    const r = await uks(["frobnicate", "--json"]);
    expect(r.code).toBe(2);
    const doc = r.json();
    expect(doc).toMatchObject({ ok: false, error: "bad-arguments", exit_code: 2 });
    expect(r.stderr).toContain("uks: ");
  });

  it("a bad --api-base", async () => {
    const r = await uks(["plans", "--api-base", "ftp://example.com"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--api-base");
  });
});

describe("--api-base and UKS_API_BASE", () => {
  it("default is https://urbankitstudio.com", async () => {
    const f = fakeFetch({ body: PLANS });
    await uks(["plans"], { fetch: f.fetch });
    expect(f.calls[0]!.url.href).toBe("https://urbankitstudio.com/api/v1/plans");
  });

  it("env UKS_API_BASE is used, and --api-base wins over it", async () => {
    const f = fakeFetch({ body: PLANS });
    await uks(["plans"], { fetch: f.fetch, env: { UKS_API_BASE: "http://127.0.0.1:4000/" } });
    expect(f.calls[0]!.url.href).toBe("http://127.0.0.1:4000/api/v1/plans");
    await uks(["plans", "--api-base", "https://staging.example.com"], { fetch: f.fetch, env: { UKS_API_BASE: "http://127.0.0.1:4000" } });
    expect(f.calls[1]!.url.href).toBe("https://staging.example.com/api/v1/plans");
  });

  it("global flags work before the command too", async () => {
    const f = fakeFetch({ body: PLANS });
    const r = await uks(["--json", "plans"], { fetch: f.fetch });
    expect(r.code).toBe(0);
    expect(r.json().plans).toHaveLength(PLANS.plans.length);
  });
});
