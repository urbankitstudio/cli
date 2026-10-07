import type { Context } from "./context.js";
import { ACCOUNT_URL } from "./context.js";
import { CliError, EXIT } from "./errors.js";
import { str } from "./format.js";
import { CLI_VERSION } from "./version.js";

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

export interface ApiRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  key?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** localhost, ::1, or anything in 127.0.0.0/8. URL has already normalized the host ("127.1" -> "127.0.0.1"). */
export function isLoopback(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/** Accepts an http(s) origin, optionally with a path prefix; returns it without a trailing slash. */
export function normalizeApiBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(EXIT.FAILED, "bad-api-base", `--api-base '${raw}' is not a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CliError(EXIT.FAILED, "bad-api-base", `--api-base must be an http(s) URL, got '${url.protocol}'.`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new CliError(EXIT.FAILED, "bad-api-base", "--api-base takes an origin (and optional path), with no query, fragment or credentials.");
  }
  return url.toString().replace(/\/+$/, "");
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "the request timed out";
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return cause.code;
    if (cause?.message === "bad port") return "fetch refuses that port (it is on the WHATWG blocked-port list)";
    if (cause?.message) return cause.message;
    return err.message;
  }
  return String(err);
}

/** Unix seconds or milliseconds (either appears) to ISO; null when absent or unreadable. */
function resetFromHeader(value: string | null): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intHeader(headers: Headers, name: string): number | null {
  const v = headers.get(name);
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intField(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The fields of a 429 an agent needs to decide when to retry. Three bodies reach
 * the CLI: "rate-limited" (the per-IP limiter on /api/v1/me, /api/v1/usage and
 * /api/atlas/request), "rate_limited" (the key's or the anonymous quota on
 * /api/atlas/lookup, the only one carrying upgrade_url) and "request-budget"
 * (the county-request store's daily budget).
 */
export function rateLimitDetails(ctx: Context, res: ApiResponse) {
  const retryAfter = intHeader(res.headers, "retry-after");
  const resetAt =
    str(res.body.reset) ??
    resetFromHeader(res.headers.get("x-ratelimit-reset")) ??
    (retryAfter !== null ? new Date(ctx.deps.now().getTime() + retryAfter * 1000).toISOString() : null);
  const upgradeUrl = str(res.body.upgrade_url);
  return {
    retry_after_seconds: retryAfter,
    reset_at: resetAt,
    limit: intField(res.body.limit) ?? intHeader(res.headers, "x-ratelimit-limit"),
    remaining: intField(res.body.remaining) ?? intHeader(res.headers, "x-ratelimit-remaining"),
    ...(upgradeUrl ? { upgrade_url: upgradeUrl } : {}),
  };
}

/** The account routes carry two limiters (per IP, per account); the header says which one fired. */
function accountRateLimitMessage(limit: number | null): string {
  const n = limit === null ? "" : `${limit} requests per minute`;
  return `Rate limited${n ? ` (${n})` : ""}. Try again in a minute.`;
}

/** Turns any non-2xx into a CliError carrying the right exit code. */
export function failFor(ctx: Context, res: ApiResponse, req: Pick<ApiRequest, "path" | "key">): never {
  const serverCode = str(res.body.error);
  const serverMessage = str(res.body.message);
  const base = { http_status: res.status, server: res.body };
  if (res.status === 429) {
    const q = rateLimitDetails(ctx, res);
    let message: string;
    if (req.path.startsWith("/api/v1/")) {
      message = accountRateLimitMessage(q.limit ?? null);
    } else {
      const when = q.reset_at ? ` Resets at ${q.reset_at}.` : "";
      const upgrade = q.upgrade_url ? ` Upgrade: ${q.upgrade_url}` : "";
      message = `${serverMessage ?? `Rate limited (HTTP 429).`}${when}${upgrade}`;
    }
    throw new CliError(EXIT.QUOTA, serverCode ?? "rate-limited", message, { ...base, ...q });
  }
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    // The server's 401 message tells a raw HTTP caller how to send a key; the
    // CLI's own hint replaces it (the server body stays in --json `server`).
    const message =
      res.status === 401
        ? req.key
          ? "The key was not accepted. Check it with `uks login --key uk_live_...` or UKS_API_KEY."
          : `This needs an API key: \`uks login --key uk_live_...\` or UKS_API_KEY. Create a key at ${ACCOUNT_URL} (free tier).`
        : (serverMessage ?? `The server refused the request (HTTP ${res.status}).`);
    throw new CliError(EXIT.REFUSED, serverCode ?? (res.status === 401 ? "unauthorized" : "forbidden"), message, base);
  }
  if (res.status === 503 && serverCode === "rate-limiter-unavailable") {
    throw new CliError(
      EXIT.FAILED,
      serverCode,
      "The server's rate limiter is unavailable, so this request was refused rather than served unmetered. Try again in a minute.",
      base,
    );
  }
  if (res.status >= 500) {
    throw new CliError(
      EXIT.FAILED,
      serverCode ?? "server-error",
      `The server failed (HTTP ${res.status})${serverMessage ? `: ${serverMessage}` : ""}. Try again in a minute.`,
      base,
    );
  }
  throw new CliError(
    EXIT.FAILED,
    serverCode ?? `http-${res.status}`,
    serverMessage ?? `The request was rejected (HTTP ${res.status}${serverCode ? `, ${serverCode}` : ""}).`,
    base,
  );
}

/** One HTTP call. Throws CliError for network failures and unreadable bodies; returns every status otherwise. */
export async function apiRequest(ctx: Context, req: ApiRequest): Promise<ApiResponse> {
  const url = new URL(ctx.apiBase + req.path);
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  if (req.key && url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new CliError(
      EXIT.FAILED,
      "insecure-api-base",
      `Refusing to send an API key over plain http to ${url.host}. Use https, or a loopback address for local testing.`,
    );
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `uks-cli/${CLI_VERSION}`,
  };
  if (req.key) headers.authorization = `Bearer ${req.key}`;
  if (req.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await ctx.deps.fetch(url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CliError(EXIT.FAILED, "network-error", `Could not reach ${url.origin}: ${describeNetworkError(err)}.`, {
      url: `${url.origin}${url.pathname}`,
    });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw new CliError(EXIT.FAILED, "network-error", `The connection to ${url.origin} dropped: ${describeNetworkError(err)}.`);
  }
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    if (response.status >= 500) {
      throw new CliError(EXIT.FAILED, "server-error", `The server failed (HTTP ${response.status}). Try again in a minute.`, {
        http_status: response.status,
      });
    }
    if (response.status === 429) {
      body = {};
    } else {
      throw new CliError(
        EXIT.FAILED,
        "bad-response",
        `${url.origin}${url.pathname} answered HTTP ${response.status} without a JSON object. Is --api-base right?`,
        { http_status: response.status },
      );
    }
  }
  return { status: response.status, headers: response.headers, body: body as Record<string, unknown> };
}

/** apiRequest, then failFor on anything outside 2xx. */
export async function apiCall(ctx: Context, req: ApiRequest): Promise<ApiResponse> {
  const res = await apiRequest(ctx, req);
  if (res.status < 200 || res.status > 299) failFor(ctx, res, req);
  return res;
}
