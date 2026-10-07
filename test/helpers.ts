import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { run } from "../src/cli.js";
import type { Deps } from "../src/context.js";

export const KEY = "uk_live_TESTKEY0123456789abcdef"; // gitleaks:allow (a fixture, never a real key)

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  /** Raw text instead of JSON. */
  text?: string;
  headers?: Record<string, string>;
  /** Throw this instead of answering (a network failure). */
  throws?: unknown;
}

export function fakeFetch(reply: FakeReply | ((call: Call) => FakeReply)) {
  const calls: Call[] = [];
  const fn = (async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const r = typeof reply === "function" ? reply(call) : reply;
    if (r.throws !== undefined) throw r.throws;
    const text = r.text ?? JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

/** A fetch that fails the test if anything calls it. */
export const noNetwork = (async () => {
  throw new Error("offline command touched the network");
}) as unknown as typeof fetch;

export function networkError(code = "ECONNREFUSED") {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code} 127.0.0.1:9`), { code }) });
}

const tempHomes: string[] = [];

/** A fresh home directory, removed after the test that made it. */
export function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "uks-cli-test-"));
  tempHomes.push(dir);
  return dir;
}

// Registered on every test file that imports these helpers.
afterEach(() => {
  for (const dir of tempHomes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout parsed as JSON (only valid with --json). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests index into arbitrary JSON documents
  json: () => any;
}

export async function uks(
  argv: string[],
  opts: { fetch?: typeof fetch; env?: Record<string, string | undefined>; home?: string; platform?: NodeJS.Platform; stdin?: string } = {},
): Promise<Result> {
  let stdout = "";
  let stderr = "";
  const home = opts.home ?? tempHome();
  const deps: Deps = {
    fetch: opts.fetch ?? noNetwork,
    // HOME-only env by default: never the developer's real UKS_API_KEY or APPDATA.
    env: { APPDATA: join(home, "AppData", "Roaming"), ...(opts.env ?? {}) },
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    readStdin: async () => opts.stdin ?? "",
    platform: opts.platform ?? "linux",
    homedir: home,
    now: () => new Date("2026-10-06T12:00:00Z"),
  };
  const code = await run(argv, deps);
  return { code, stdout, stderr, json: () => JSON.parse(stdout) };
}
