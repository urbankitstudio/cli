// Response shapes the CLI codes against, copied from the REAL handlers on branch
// claude/hana-agent-first-v1 at commit 76df68dc: api/v1/plans.ts (publicPlans()
// from src/lib/tiers.ts), api/v1/me.ts, api/v1/usage.ts, api/_lib/quota-peek.ts,
// api/_lib/ratelimit.ts rateLimitedResponse, api/_lib/atlas-gate.ts funnel429 and
// api/atlas/request.ts. Two v1 fix-ups are applied ahead of that branch:
// `requires_flag` is gone from /plans, and /usage carries `incomplete: true`
// when the page cap is hit.

const login = (tier: string) => `https://urbankitstudio.com/login?plan=${tier}`;
const FULL = { discovery: true, owner_data: true, bulk: true, radius: true };
const NO_OWNER = { discovery: true, owner_data: false, bulk: false, radius: false };
const SALES_NOTE = "Sales-led: the limit is set per contract on the key. Until provisioned it falls back to the free limit.";

/** GET /api/v1/plans with ENABLE_PAYG off (publicPlans({ paygEnabled: false })). */
export const PLANS = {
  ok: true,
  as_of: "2026-10-06T14:00:00.000Z",
  currency: "usd",
  plans: [
    {
      id: "free", name: "Free", retired: false, purchasable: false, sales_led: false,
      price: { usd_per_month: 0 }, trial_days: null,
      quota: { limit: 500, window: "day", note: "500 keyed calls per UTC day." },
      entitlements: NO_OWNER, upgrade_url: null,
    },
    {
      id: "starter", name: "Starter", retired: false, purchasable: true, sales_led: false,
      price: { usd_per_month: 7 }, trial_days: 7,
      quota: { limit: 150, window: "month", note: "150 lookups per UTC calendar month." },
      entitlements: FULL, upgrade_url: login("starter"),
    },
    {
      id: "individual", name: "Studio", retired: false, purchasable: true, sales_led: false,
      price: { usd_per_month: 19 }, trial_days: 7,
      quota: { limit: 2000, window: "day", note: "2,000 lookups per UTC day." },
      entitlements: FULL, upgrade_url: login("individual"),
    },
    {
      id: "pro", name: "Pro", retired: false, purchasable: true, sales_led: false,
      price: { usd_per_month: 149 }, trial_days: 7,
      quota: { limit: 10000, window: "day", note: "10,000 lookups per UTC day." },
      entitlements: FULL, upgrade_url: login("pro"),
    },
    {
      id: "payg", name: "Pay-as-you-go", retired: false, purchasable: false, sales_led: false,
      price: { usd_per_unit: 0.05 }, trial_days: null,
      quota: {
        limit: 10000,
        window: "day",
        note: "Abuse safety ceiling per UTC day, not a product quota: each billable answer is charged per unit.",
      },
      entitlements: { discovery: true, owner_data: "mcp-only", bulk: false, radius: false },
      upgrade_url: null,
    },
    {
      id: "dev", name: "Developer", retired: true, purchasable: false, sales_led: false,
      price: { usd_per_month: 19 }, trial_days: null,
      quota: { limit: 2000, window: "day", note: "Retired: existing subscribers keep 2,000 lookups per UTC day." },
      entitlements: FULL, upgrade_url: null,
    },
    {
      id: "team", name: "Team", retired: false, purchasable: false, sales_led: true,
      price: null, trial_days: null,
      quota: { limit: 500, window: "day", note: SALES_NOTE },
      entitlements: FULL, upgrade_url: "https://urbankitstudio.com/enterprise",
    },
    {
      id: "enterprise", name: "Enterprise", retired: false, purchasable: false, sales_led: true,
      price: null, trial_days: null,
      quota: { limit: 500, window: "day", note: SALES_NOTE },
      entitlements: FULL, upgrade_url: "https://urbankitstudio.com/enterprise",
    },
  ],
  docs: "https://urbankitstudio.com/developers",
};

const STARTER_TOOLS = [
  "find_parcel_by_address",
  "geocode_address",
  "list_indexed_states",
  "list_counties_in_state",
  "find_county_by_fips",
  "get_county_endpoint",
  "request_county",
  "enrich_address",
  "radius_owners",
];

/** GET /api/v1/me for a Starter key (the v1 PR body example). quota_status lives INSIDE quota. */
export function me(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    as_of: "2026-10-06T14:00:00.000Z",
    user_id: "aaaaaaaa-1111-1111-1111-111111111111",
    tier: "starter",
    key: { key_prefix: "uk_live_AAAA", label: "agent", created_at: "2026-08-01T00:00:00Z", last_used_at: "2026-10-05T00:00:00Z" },
    quota: { window: "month", used: 12, limit: 150, remaining: 138, reset_at: "2026-11-01T00:00:00.000Z", quota_status: "ok" },
    entitlements: { ...FULL, tools: STARTER_TOOLS },
    subscription: { status: "active", trial_used: true, current_period_end: "2026-11-01T00:00:00Z", cancel_at_period_end: false },
    upgrade_url: login("individual"),
    plans_url: "/api/v1/plans",
    ...overrides,
  };
}

/** The quota block when the Upstash peek fails: used and remaining null, never 0. */
export const QUOTA_UNAVAILABLE = {
  window: "month",
  used: null,
  limit: 150,
  remaining: null,
  reset_at: "2026-11-01T00:00:00.000Z",
  quota_status: "unavailable",
};

/** GET /api/v1/usage?from=2026-10-01&to=2026-10-05 (the v1 PR body example). `to` is exclusive. */
export const USAGE = {
  ok: true,
  as_of: "2026-10-06T14:00:00.000Z",
  user_id: "aaaaaaaa-1111-1111-1111-111111111111",
  range: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" },
  row_cap: 5000,
  truncated: false,
  totals: { calls: 5, units: 27 },
  by_endpoint: [
    { endpoint: "lookup", calls: 3, units: 2 },
    { endpoint: "bulk", calls: 1, units: 25 },
    { endpoint: "county", calls: 1, units: 0 },
  ],
  by_day: [
    { date: "2026-10-03", calls: 1, units: 0 },
    { date: "2026-10-04", calls: 2, units: 25 },
    { date: "2026-10-05", calls: 2, units: 2 },
  ],
  by_key: [
    { api_key_id: "cccccccc-0000-0000-0000-000000000000", calls: 2, units: 2 },
    { api_key_id: "dddddddd-0000-0000-0000-000000000000", calls: 2, units: 25 },
    { api_key_id: null, calls: 1, units: 0 },
  ],
  live: { window: "day", used: 40, limit: 10000, remaining: 9960, reset_at: "2026-10-07T00:00:00.000Z", quota_status: "ok" },
};

/** 429 from the per-IP limiter on /api/v1/me, /api/v1/usage and /api/atlas/request (rateLimitedResponse). */
export const ACCOUNT_429 = {
  status: 429,
  body: { ok: false, error: "rate-limited", message: "Too many requests. Retry in 42s." },
  headers: {
    "retry-after": "42",
    "x-ratelimit-limit": "60",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "1791295242",
  },
};

/** 429 from /api/atlas/lookup when a free key's quota is spent (atlas-gate funnel429, funnelCopy("free")). */
export const LOOKUP_QUOTA_429 = {
  status: 429,
  body: {
    ok: false,
    error: "rate_limited",
    message: "Daily limit reached (free tier — 500 requests/day). Upgrade for a higher limit.",
    limit: 500,
    remaining: 0,
    reset: "2026-10-07T00:00:00.000Z",
    upgrade_url: "https://urbankitstudio.com/enterprise",
  },
  headers: {
    "retry-after": "43200",
    "x-ratelimit-limit": "500",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "1791331200",
  },
};

/** 429 from /api/atlas/request when the daily storage budget is spent. No x-ratelimit-* headers. */
export const REQUEST_BUDGET_429 = {
  status: 429,
  body: {
    ok: false,
    error: "request-budget",
    message: "The daily budget for county requests has been reached. The request was not stored. Try again later.",
  },
  headers: { "retry-after": "3600" },
};

export const LOOKUP_MATCHED = {
  ok: true,
  matched: true,
  geocode: { lat: 41.9, lon: -88.3, countyName: "Kane", stateAbbrev: "IL", countyFips: "17089" },
  geocode_stale: false,
  atlas_indexed: true,
  county: {
    state_slug: "illinois",
    state_name: "Illinois",
    county_name: "Kane County",
    county_slug: "kane-county",
    county_fips: "17089",
    has_public_rest: true,
    endpoints: [
      {
        url: "https://gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0",
        service_type: "MapServer",
        layer_name: "Kane.DBO.Parcels_v2025",
        endpoint_status: "live",
        sample_query: "https://example.test/query",
      },
    ],
    urbankit_county_page: "https://urbankitstudio.com/parcel-atlas/illinois/kane-county",
  },
  rate_limit: { limit: 5, remaining: 4, reset: "2026-10-06T13:00:00.000Z" },
};

export const LOOKUP_NOT_INDEXED = {
  ok: true,
  matched: true,
  geocode: { lat: 45.6, lon: -84.5, countyName: "Cheboygan", stateAbbrev: "MI", countyFips: "26031" },
  geocode_stale: false,
  atlas_indexed: false,
  fallback: "Cheboygan, MI (FIPS 26031) is not in the UrbanKit atlas yet. Try the County Assessor site directly.",
  request: {
    how: "POST",
    url: "https://urbankitstudio.com/api/atlas/request",
    body: { county_fips: "26031", county_name: "Cheboygan", state_abbrev: "MI" },
    message: "This county is not in the UrbanKit atlas yet.",
  },
};

export const LOOKUP_NO_GEOCODE = {
  ok: true,
  query: { address: "not an address" },
  matched: false,
  message: "No geocode match. Provide a full street + city + state.",
};
