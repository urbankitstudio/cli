import type { Context } from "../context.js";
import { emit } from "../context.js";
import { resolveKey } from "../credentials.js";
import { EXIT, usageError } from "../errors.js";
import { arr, fields, num, obj, str } from "../format.js";
import { apiCall } from "../http.js";

// ---------------------------------------------------------------- lookup

export async function lookupCommand(ctx: Context, positionals: string[]): Promise<number> {
  const address = positionals.join(" ").trim();
  if (address.length < 3) throw usageError('lookup needs a full street address, e.g. uks lookup "1200 Market St, Philadelphia, PA".');
  // Keyless works at the anonymous per-IP limit; a key, when there is one, raises it.
  const found = await resolveKey(ctx.deps);
  const res = await apiCall(ctx, { method: "GET", path: "/api/atlas/lookup", query: { address }, key: found?.key });
  const body = res.body;
  emit(ctx, body, () => renderLookup(body));
  return EXIT.OK;
}

function renderLookup(body: Record<string, unknown>): string {
  if (body.matched !== true) return `No match. ${str(body.message) ?? "Provide a full street + city + state."}`;
  const g = obj(body.geocode) ?? {};
  const where = `${str(g.countyName) ?? "?"}, ${str(g.stateAbbrev) ?? "?"} (FIPS ${str(g.countyFips) ?? "?"})`;
  const lines = [fields([
    ["Geocoded", `${num(g.lat)}, ${num(g.lon)}`],
    ["County", where],
  ])];
  if (body.geocode_stale === true) lines.push("The geocoder was unavailable, so this is the last cached geocode for the address.");
  if (body.atlas_indexed === false) {
    lines.push("", str(body.fallback) ?? "This county is not in the UrbanKit atlas yet.");
    const fips = str(obj(obj(body.request)?.body)?.county_fips) ?? str(g.countyFips);
    if (fips) lines.push(`Request it (free): uks request-county --fips ${fips}`);
    return lines.join("\n");
  }
  const county = obj(body.county);
  if (county) {
    const endpoints = arr(county.endpoints);
    endpoints.forEach((ep, i) => {
      lines.push(
        "",
        `Endpoint ${i + 1}: ${str(ep.layer_name) ?? "?"} (${str(ep.service_type) ?? "?"})`,
        fields([
          ["  URL", str(ep.url)],
          ["  Status", str(ep.endpoint_status)],
          ["  Sample query", str(ep.sample_query)],
        ]),
      );
    });
    if (str(county.urbankit_county_page)) lines.push("", `County page: ${county.urbankit_county_page}`);
  }
  if (str(body.message)) lines.push("", String(body.message));
  const rl = obj(body.rate_limit);
  if (rl) lines.push(`Rate limit: ${num(rl.remaining)} of ${num(rl.limit)} left${str(rl.reset) ? `, resets ${rl.reset}` : ""}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- request-county

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export interface RequestCountyOptions {
  fips?: string;
  state?: string;
  county?: string;
  email?: string;
  note?: string;
  "source-url"?: string;
}

export function buildCountyRequest(o: RequestCountyOptions): Record<string, string> {
  const body: Record<string, string> = {};
  const bySlug = o.state !== undefined || o.county !== undefined;
  if (o.fips !== undefined && bySlug) throw usageError("Name the county by --fips, or by --state and --county, not both.");
  if (o.fips !== undefined) {
    if (!/^\d{5}$/.test(o.fips)) throw usageError("--fips must be 5 digits: the 2-digit state code then the 3-digit county code, e.g. 06003.");
    body.county_fips = o.fips;
  } else if (bySlug) {
    if (o.state === undefined || o.county === undefined) throw usageError("--state and --county go together.");
    for (const [flag, v] of [["state", o.state], ["county", o.county]] as const) {
      if (!SLUG.test(v) || v.length > 64) {
        throw usageError(`--${flag} must be a lowercase slug with single hyphens (a-z, 0-9), e.g. ${flag === "state" ? "illinois" : "kane-county"}; got '${v}'.`);
      }
    }
    body.state_slug = o.state;
    body.county_slug = o.county;
  } else {
    throw usageError("request-county needs --fips <5 digits>, or --state <slug> --county <slug>.");
  }
  if (o.email !== undefined) {
    if (o.email.length > 255 || !EMAIL.test(o.email)) throw usageError("--email is not an email address.");
    body.requester_email = o.email;
  }
  if (o.note !== undefined) {
    if (o.note.length > 1000) throw usageError("--note is limited to 1000 characters.");
    body.note = o.note;
  }
  if (o["source-url"] !== undefined) {
    const u = o["source-url"];
    let ok: boolean;
    try {
      ok = new URL(u).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok || u.length > 500) throw usageError("--source-url must be an https:// link of at most 500 characters.");
    body.source_url = u;
  }
  return body;
}

export async function requestCountyCommand(ctx: Context, opts: RequestCountyOptions): Promise<number> {
  const body = buildCountyRequest(opts);
  // Free and keyless on every tier: no key is sent.
  const res = await apiCall(ctx, { method: "POST", path: "/api/atlas/request", body });
  const out = res.body;
  emit(ctx, out, () => {
    const what = body.county_fips ? `FIPS ${body.county_fips}` : `${body.county_slug} in ${body.state_slug}`;
    return [
      `Request for ${what} accepted${str(out.id) ? ` (id ${out.id})` : ""}.`,
      "Repeating this request within 24 hours returns the same id.",
      body.requester_email ? "You will get one email when the county ships." : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return EXIT.OK;
}
