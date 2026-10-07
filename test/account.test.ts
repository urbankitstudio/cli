import { describe, expect, it } from "vitest";
import { rangeText } from "../src/commands/account.js";
import { isLoopback } from "../src/http.js";
import { fakeFetch, KEY, networkError, uks } from "./helpers.js";
import { ACCOUNT_429, me, PLANS, QUOTA_UNAVAILABLE, USAGE } from "./fixtures.js";

const withKey = { UKS_API_KEY: KEY };

/** The table row for one plan name. */
function row(stdout: string, name: string): string {
  const line = stdout.split("\n").find((l) => l.startsWith(`${name} `));
  if (!line) throw new Error(`no row for ${name}`);
  return line;
}

describe("plans", () => {
  it("--json prints the server document unchanged, keyless", async () => {
    const f = fakeFetch({ body: PLANS });
    const r = await uks(["plans", "--json"], { fetch: f.fetch, env: withKey });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual(PLANS);
    expect(f.calls[0]!.headers.authorization).toBeUndefined();
    expect(f.calls[0]!.headers["user-agent"]).toMatch(/^uks-cli\//);
  });

  it("human output is a table of plan, price, quota, owner data and notes", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ body: PLANS }).fetch });
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")[0]).toMatch(/^PLAN\s+PRICE\s+QUOTA\s+OWNER DATA\s+NOTES$/);
    expect(row(r.stdout, "Free")).toMatch(/^Free\s+free\s+500 \/ day\s+no\s+500 keyed calls per UTC day\.$/);
    expect(row(r.stdout, "Starter")).toMatch(/^Starter\s+\$7\/month\s+150 \/ month\s+yes\s+7-day trial\. 150 lookups/);
    expect(row(r.stdout, "Pro")).toMatch(/^Pro\s+\$149\/month\s+10,000 \/ day\s+yes\s+7-day trial/);
    expect(r.stdout).toContain("Docs: https://urbankitstudio.com/developers");
  });

  it("pay-as-you-go: owner data is MCP only, and with its flag off it is not open for self-serve", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ body: PLANS }).fetch });
    expect(row(r.stdout, "Pay-as-you-go")).toMatch(/^Pay-as-you-go\s+\$0\.05\/unit\s+10,000 \/ day\s+MCP only\s+not open for self-serve yet\./);
  });

  it("the free plan, though not purchasable, is not flagged as closed", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ body: PLANS }).fetch });
    expect(row(r.stdout, "Free")).not.toContain("self-serve");
  });

  it("sales-led plans: price null reads 'contact sales' and the note carries the sales link", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ body: PLANS }).fetch });
    for (const name of ["Team", "Enterprise"]) {
      expect(row(r.stdout, name)).toMatch(new RegExp(`^${name}\\s+contact sales\\s+500 / day\\s+yes\\s+sales-led: https://urbankitstudio\\.com/enterprise\\.`));
    }
  });

  it("a retired plan says so", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ body: PLANS }).fetch });
    expect(row(r.stdout, "Developer")).toMatch(/^Developer\s+\$19\/month\s+2,000 \/ day\s+yes\s+retired\./);
  });

  it("a null price on a plan that is not sales-led reads '-'", async () => {
    const body = { ...PLANS, plans: [{ ...PLANS.plans[0]!, name: "Odd", price: null }] };
    const r = await uks(["plans"], { fetch: fakeFetch({ body }).fetch });
    expect(row(r.stdout, "Odd")).toMatch(/^Odd\s+-\s+500/);
  });

  it("5xx exits 2", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ status: 503, body: { ok: false, error: "unavailable" } }).fetch });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("HTTP 503");
  });

  it("5xx with an HTML body still exits 2 with a clean message", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ status: 502, text: "<html>Bad gateway</html>" }).fetch });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("uks: The server failed (HTTP 502). Try again in a minute.\n");
  });

  it("a network error exits 2 with no stack trace", async () => {
    const r = await uks(["plans", "--json"], { fetch: fakeFetch({ throws: networkError() }).fetch });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("uks: Could not reach https://urbankitstudio.com: ECONNREFUSED.\n");
    expect(r.stderr).not.toMatch(/\bat \S+:\d+/);
    expect(r.json()).toMatchObject({ ok: false, error: "network-error", exit_code: 2 });
  });

  it("fetch's blocked-port refusal reads as a network error, exit 2", async () => {
    const r = await uks(["plans", "--api-base", "http://127.0.0.1:9"], {
      fetch: fakeFetch({ throws: new TypeError("fetch failed", { cause: new Error("bad port") }) }).fetch,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("uks: Could not reach http://127.0.0.1:9: fetch refuses that port (it is on the WHATWG blocked-port list).\n");
  });

  it("a 200 that is not JSON exits 2", async () => {
    const r = await uks(["plans"], { fetch: fakeFetch({ status: 200, text: "<!doctype html>" }).fetch });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("without a JSON object");
  });
});

describe("whoami", () => {
  it("without a key exits 1 and makes no request", async () => {
    const f = fakeFetch({ body: me() });
    const r = await uks(["whoami"], { fetch: f.fetch });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      "uks: This command needs an API key. Run `uks login --key uk_live_...` or set UKS_API_KEY. Create a key at https://urbankitstudio.com/account (free tier).\n",
    );
    expect(f.calls).toHaveLength(0);
  });

  it("sends the key as a bearer token and shows only the server's prefix", async () => {
    const f = fakeFetch({ body: me() });
    const r = await uks(["whoami"], { fetch: f.fetch, env: withKey });
    expect(r.code).toBe(0);
    expect(f.calls[0]!.url.pathname).toBe("/api/v1/me");
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(r.stdout).toContain("uk_live_AAAA...");
    expect(r.stdout).not.toContain(KEY);
    expect(r.stderr).not.toContain(KEY);
    expect(r.stdout).toMatch(/Tier:\s+starter/);
    expect(r.stdout).toMatch(/Quota:\s+12 of 150 used this month, 138 remaining, resets 2026-11-01T00:00:00\.000Z/);
    expect(r.stdout).toMatch(/Subscription:\s+active, renews 2026-11-01T00:00:00Z/);
    expect(r.stdout).toMatch(/Owner data:\s+yes/);
    expect(r.stdout).toMatch(/Tools:\s+find_parcel_by_address, .*radius_owners/);
    expect(r.stdout).toMatch(/Key from:\s+UKS_API_KEY/);
    expect(r.stdout).not.toContain("Quota is low");
  });

  it("--json prints the server document", async () => {
    const body = me();
    const r = await uks(["whoami", "--json"], { fetch: fakeFetch({ body }).fetch, env: withKey });
    expect(r.code).toBe(0);
    expect(r.json()).toEqual(body);
  });

  it("no subscription reads 'none'", async () => {
    const r = await uks(["whoami"], { fetch: fakeFetch({ body: me({ subscription: null }) }).fetch, env: withKey });
    expect(r.stdout).toMatch(/Subscription:\s+none/);
  });

  it("shows the server's upgrade link when remaining is low", async () => {
    const body = me({ quota: { window: "month", used: 140, limit: 150, remaining: 10, reset_at: "2026-11-01T00:00:00.000Z", quota_status: "ok" } });
    const r = await uks(["whoami"], { fetch: fakeFetch({ body }).fetch, env: withKey });
    expect(r.stdout).toContain("Quota is low. Upgrade: https://urbankitstudio.com/login?plan=individual");
  });

  it("upgrade_url null (Pro, the top of the ladder) prints no upgrade link and no fallback", async () => {
    const body = me({
      tier: "pro",
      upgrade_url: null,
      quota: { window: "day", used: 9990, limit: 10000, remaining: 10, reset_at: "2026-10-07T00:00:00.000Z", quota_status: "ok" },
    });
    const r = await uks(["whoami"], { fetch: fakeFetch({ body }).fetch, env: withKey });
    expect(r.stdout).toContain("Quota is low.");
    expect(r.stdout).not.toContain("Upgrade");
    expect(r.stdout).not.toContain("/pricing");
  });

  it("quota.quota_status 'unavailable' prints 'unavailable right now', not dashes", async () => {
    const body = me({ quota: QUOTA_UNAVAILABLE });
    const r = await uks(["whoami"], { fetch: fakeFetch({ body }).fetch, env: withKey });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Quota:\s+unavailable right now/);
    expect(r.stdout).not.toContain("- of 150");
    expect(r.stdout).not.toContain("Quota is low");
  });

  it("a pay-as-you-go key's owner data reads 'MCP only'", async () => {
    const body = me({ tier: "payg", entitlements: { discovery: true, owner_data: "mcp-only", bulk: false, radius: false, tools: [] } });
    const r = await uks(["whoami"], { fetch: fakeFetch({ body }).fetch, env: withKey });
    expect(r.stdout).toMatch(/Owner data:\s+MCP only/);
  });

  it("401 exits 1, keeps the server's error code in --json, and gives the key guidance once", async () => {
    const server = {
      ok: false,
      error: "invalid-key",
      message:
        "A valid API key is required. Create a free key at https://urbankitstudio.com/account and send it as 'Authorization: Bearer uk_live_...'. See https://urbankitstudio.com/pricing.",
    };
    const r = await uks(["whoami", "--json"], { fetch: fakeFetch({ status: 401, body: server }).fetch, env: withKey });
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: "invalid-key", exit_code: 1, http_status: 401, server });
    expect(r.stderr).toBe("uks: The key was not accepted. Check it with `uks login --key uk_live_...` or UKS_API_KEY.\n");
    expect(r.stdout).not.toContain(KEY);
  });

  it.each([402, 403])("%i exits 1", async (status) => {
    const r = await uks(["whoami"], { fetch: fakeFetch({ status, body: { ok: false, error: "plan-required" } }).fetch, env: withKey });
    expect(r.code).toBe(1);
  });

  it("429 from the per-IP limiter exits 3: the account wording, the reset, no upgrade link", async () => {
    const r = await uks(["whoami", "--json"], { fetch: fakeFetch(ACCOUNT_429).fetch, env: withKey });
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("uks: Rate limited (60 requests per minute). Try again in a minute.\n");
    const doc = r.json();
    expect(doc).toMatchObject({
      ok: false,
      error: "rate-limited",
      exit_code: 3,
      reset_at: "2026-10-06T14:00:42.000Z",
      retry_after_seconds: 42,
      limit: 60,
      remaining: 0,
    });
    expect(doc).not.toHaveProperty("upgrade_url");
    expect(doc).not.toHaveProperty("upgrade");
  });

  it("429 with only Retry-After derives reset_at from it", async () => {
    const r = await uks(["whoami", "--json"], {
      fetch: fakeFetch({ status: 429, body: { ok: false, error: "rate-limited" }, headers: { "retry-after": "60" } }).fetch,
      env: withKey,
    });
    expect(r.code).toBe(3);
    expect(r.json().reset_at).toBe("2026-10-06T12:01:00.000Z");
  });

  it("refuses to send a key over plain http to a non-loopback host", async () => {
    const f = fakeFetch({ body: me() });
    const r = await uks(["whoami", "--api-base", "http://example.com"], { fetch: f.fetch, env: withKey });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Refusing to send an API key over plain http");
    expect(f.calls).toHaveLength(0);
  });

  it.each(["http://127.0.0.2:8080", "http://localhost:3000", "http://[::1]:3000", "http://127.1:3000"])(
    "sends a key over plain http to the loopback %s",
    async (base) => {
      const f = fakeFetch({ body: me() });
      const r = await uks(["whoami", "--api-base", base], { fetch: f.fetch, env: withKey });
      expect(r.code).toBe(0);
      expect(f.calls).toHaveLength(1);
    },
  );

  it("isLoopback: 127.0.0.0/8, localhost and ::1 only", () => {
    for (const h of ["127.0.0.1", "127.0.0.2", "127.255.255.255", "localhost", "[::1]"]) expect(isLoopback(h)).toBe(true);
    for (const h of ["128.0.0.1", "127.0.0.1.example.com", "127.0.0.256", "example.com", "10.0.0.1", "[::2]"]) expect(isLoopback(h)).toBe(false);
  });

  it("a malformed UKS_API_KEY exits 2 without echoing it", async () => {
    const r = await uks(["whoami"], { env: { UKS_API_KEY: "sk_wrong_secret" } });
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain("sk_wrong_secret");
  });
});

describe("usage", () => {
  it("passes --from/--to and prints the inclusive day range, totals, by endpoint and by day", async () => {
    const f = fakeFetch({ body: USAGE });
    const r = await uks(["usage", "--from", "2026-10-01", "--to", "2026-10-05"], { fetch: f.fetch, env: withKey });
    expect(r.code).toBe(0);
    expect(f.calls[0]!.url.pathname).toBe("/api/v1/usage");
    expect(f.calls[0]!.url.searchParams.get("from")).toBe("2026-10-01");
    expect(f.calls[0]!.url.searchParams.get("to")).toBe("2026-10-05");
    expect(r.stdout).toContain("Usage 2026-10-01 to 2026-10-05 (UTC days, inclusive)");
    expect(r.stdout).toContain("Total: 5 calls, 27 units\n");
    expect(r.stdout).toContain("Now: 40 of 10,000 used this day, 9,960 remaining, resets 2026-10-07T00:00:00.000Z");
    expect(r.stdout).toMatch(/^lookup\s+3\s+2$/m);
    expect(r.stdout).toMatch(/^2026-10-05\s+2\s+2$/m);
    expect(r.stdout).not.toContain("truncated");
    expect(r.stdout).not.toContain("incomplete");
  });

  it("a range that does not sit on UTC midnights prints the ISO bounds, `to` exclusive", () => {
    expect(rangeText("2026-09-06T14:00:00.000Z", "2026-10-06T14:00:00.000Z")).toBe(
      "Usage from 2026-09-06T14:00:00.000Z until 2026-10-06T14:00:00.000Z (exclusive)",
    );
    expect(rangeText("2026-10-05T00:00:00.000Z", "2026-10-06T00:00:00.000Z")).toBe("Usage 2026-10-05 to 2026-10-05 (UTC days, inclusive)");
  });

  it("omits absent dates from the query", async () => {
    const f = fakeFetch({ body: USAGE });
    await uks(["usage"], { fetch: f.fetch, env: withKey });
    expect([...f.calls[0]!.url.searchParams.keys()]).toEqual([]);
  });

  it("--json prints the server document", async () => {
    const r = await uks(["usage", "--json"], { fetch: fakeFetch({ body: USAGE }).fetch, env: withKey });
    expect(r.json()).toEqual(USAGE);
  });

  it("notes a truncated breakdown", async () => {
    const r = await uks(["usage"], { fetch: fakeFetch({ body: { ...USAGE, truncated: true } }).fetch, env: withKey });
    expect(r.stdout).toContain("The breakdown is truncated. Narrow --from/--to for the full detail.");
  });

  it("incomplete: true prints (incomplete) after the totals", async () => {
    const r = await uks(["usage"], { fetch: fakeFetch({ body: { ...USAGE, incomplete: true } }).fetch, env: withKey });
    expect(r.stdout).toContain("Total: 5 calls, 27 units (incomplete)");
  });

  it("live.quota_status 'unavailable' prints 'unavailable right now'", async () => {
    const body = { ...USAGE, live: { ...QUOTA_UNAVAILABLE, window: "day", limit: 10000 } };
    const r = await uks(["usage"], { fetch: fakeFetch({ body }).fetch, env: withKey });
    expect(r.stdout).toContain("Now: unavailable right now");
  });

  it("429 exits 3 with the account wording", async () => {
    const r = await uks(["usage"], { fetch: fakeFetch(ACCOUNT_429).fetch, env: withKey });
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("uks: Rate limited (60 requests per minute). Try again in a minute.\n");
  });

  it.each([
    [["--from", "2026-13-01"]],
    [["--from", "2026-02-30"]],
    [["--to", "yesterday"]],
    [["--from", "2026-10-06", "--to", "2026-10-01"]],
  ])("rejects bad dates %j with exit 2 before any request", async (args) => {
    const f = fakeFetch({ body: USAGE });
    const r = await uks(["usage", ...args], { fetch: f.fetch, env: withKey });
    expect(r.code).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it("server invalid-range (400) exits 2", async () => {
    const r = await uks(["usage", "--json"], {
      fetch: fakeFetch({
        status: 400,
        body: { ok: false, error: "invalid-range", message: "The range may span at most 92 days (a date-only `to` includes that whole day)." },
      }).fetch,
      env: withKey,
    });
    expect(r.code).toBe(2);
    expect(r.json()).toMatchObject({ error: "invalid-range", http_status: 400 });
  });
});
