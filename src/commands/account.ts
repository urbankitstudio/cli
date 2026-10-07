import type { Context } from "../context.js";
import { emit } from "../context.js";
import { requireKey } from "../credentials.js";
import { usageError } from "../errors.js";
import { arr, fields, formatPrice, num, obj, ownerData, str, table } from "../format.js";
import { apiCall } from "../http.js";

function quotaText(limit: unknown, window: unknown): string {
  if (typeof limit !== "number") return "metered";
  return `${num(limit)} / ${typeof window === "string" ? window : "window"}`;
}

function isFree(price: unknown): boolean {
  return obj(price)?.usd_per_month === 0;
}

/** A plan's sales status: retired, sales-led, not yet self-serve (pay-as-you-go with its flag off), or nothing. */
function planStatus(p: Record<string, unknown>): string | undefined {
  if (p.retired === true) return "retired";
  if (p.sales_led === true) return `sales-led: ${str(p.upgrade_url) ?? "contact sales"}`;
  if (p.purchasable === false && !isFree(p.price)) return "not open for self-serve yet";
  return undefined;
}

export async function plansCommand(ctx: Context): Promise<number> {
  const res = await apiCall(ctx, { method: "GET", path: "/api/v1/plans" });
  const body = res.body;
  emit(ctx, body, () => {
    const rows = arr(body.plans).map((p) => {
      const quota = obj(p.quota) ?? {};
      const ent = obj(p.entitlements) ?? {};
      const notes: string[] = [];
      const status = planStatus(p);
      if (status) notes.push(status);
      if (typeof p.trial_days === "number" && p.trial_days > 0) notes.push(`${p.trial_days}-day trial`);
      if (str(quota.note)) notes.push(String(quota.note));
      return [
        str(p.name) ?? str(p.id) ?? "?",
        p.price === null ? (p.sales_led === true ? "contact sales" : "-") : formatPrice(p.price),
        quotaText(quota.limit, quota.window),
        ownerData(ent.owner_data),
        notes.join(". "),
      ];
    });
    const lines = [table(["PLAN", "PRICE", "QUOTA", "OWNER DATA", "NOTES"], rows)];
    const docs = str(body.docs);
    if (docs) lines.push("", `Docs: ${docs}`);
    if (str(body.as_of)) lines.push(`As of ${body.as_of}. Prices in ${String(body.currency ?? "usd").toUpperCase()}.`);
    return lines.join("\n");
  });
  return 0;
}

/** Remaining at or under a tenth of the limit (or zero) is "low". */
export function quotaIsLow(quota: Record<string, unknown>): boolean {
  const { limit, remaining } = quota;
  if (typeof limit !== "number" || typeof remaining !== "number") return false;
  return remaining <= 0 || remaining <= limit * 0.1;
}

/** One quota window (/me `quota`, /usage `live`), which carries its own quota_status. */
function quotaWindowText(q: Record<string, unknown>): string {
  if (q.quota_status === "unavailable") return "unavailable right now (the quota store did not answer)";
  return `${num(q.used)} of ${num(q.limit)} used this ${str(q.window) ?? "window"}, ${num(q.remaining)} remaining${str(q.reset_at) ? `, resets ${q.reset_at}` : ""}`;
}

export async function whoamiCommand(ctx: Context): Promise<number> {
  const { key, source } = await requireKey(ctx.deps);
  const res = await apiCall(ctx, { method: "GET", path: "/api/v1/me", key });
  const body = res.body;
  emit(ctx, body, () => {
    const k = obj(body.key) ?? {};
    const quota = obj(body.quota) ?? {};
    const sub = obj(body.subscription);
    const keyLine = [
      str(k.key_prefix) ? `${k.key_prefix}...` : "(prefix not returned)",
      str(k.label) ? `"${k.label}"` : undefined,
      str(k.created_at) ? `created ${k.created_at}` : undefined,
      str(k.last_used_at) ? `last used ${k.last_used_at}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    const quotaLine = quotaWindowText(quota);
    let subLine = "none";
    if (sub) {
      const parts = [str(sub.status) ?? "unknown"];
      if (str(sub.current_period_end)) parts.push(`${sub.cancel_at_period_end === true ? "ends" : "renews"} ${sub.current_period_end}`);
      subLine = parts.join(", ");
    }
    const tools = Array.isArray(obj(body.entitlements)?.tools) ? (obj(body.entitlements)!.tools as unknown[]).join(", ") : undefined;
    const lines = [
      fields([
        ["Tier", str(body.tier) ?? "-"],
        ["Key", keyLine],
        ["Key from", source === "env" ? "UKS_API_KEY" : "credentials file"],
        ["Quota", quotaLine],
        ["Subscription", subLine],
        ["Owner data", ownerData(obj(body.entitlements)?.owner_data)],
        ["Tools", tools],
      ]),
    ];
    // upgrade_url is null at the top of the self-serve ladder and for sales-led tiers.
    const upgradeUrl = str(body.upgrade_url);
    if (quota.quota_status !== "unavailable" && quotaIsLow(quota)) {
      lines.push("", upgradeUrl ? `Quota is low. Upgrade: ${upgradeUrl}` : "Quota is low.");
    }
    return lines.join("\n");
  });
  return 0;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function utcMidnight(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t % DAY_MS === 0 ? t : null;
}

/**
 * /usage returns range.from and range.to as ISO timestamps, `to` exclusive. When
 * both fall on UTC midnight (the dates the user passed), show the inclusive day
 * range; otherwise (the default range ends now) show the bounds as sent.
 */
export function rangeText(from: unknown, to: unknown): string {
  const f = utcMidnight(from);
  const t = utcMidnight(to);
  if (f !== null && t !== null && t > f) {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return `Usage ${day(f)} to ${day(t - DAY_MS)} (UTC days, inclusive)`;
  }
  return `Usage from ${str(from) ?? "?"} until ${str(to) ?? "?"} (exclusive)`;
}

function checkDate(flag: string, v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  if (!DATE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw usageError(`--${flag} must be a calendar date as YYYY-MM-DD, got '${v}'.`);
  }
  return v;
}

export async function usageCommand(ctx: Context, opts: { from?: string; to?: string }): Promise<number> {
  const from = checkDate("from", opts.from);
  const to = checkDate("to", opts.to);
  if (from && to && from > to) throw usageError(`--from ${from} is after --to ${to}.`);
  const { key } = await requireKey(ctx.deps);
  const res = await apiCall(ctx, { method: "GET", path: "/api/v1/usage", key, query: { from, to } });
  const body = res.body;
  emit(ctx, body, () => {
    const range = obj(body.range) ?? {};
    const totals = obj(body.totals) ?? {};
    const live = obj(body.live);
    const lines = [
      rangeText(range.from, range.to),
      `Total: ${num(totals.calls)} calls, ${num(totals.units)} units${body.incomplete === true ? " (incomplete)" : ""}`,
    ];
    if (live) lines.push(`Now: ${quotaWindowText(live)}`);
    const byEndpoint = arr(body.by_endpoint);
    lines.push("", "BY ENDPOINT");
    lines.push(
      byEndpoint.length
        ? table(["ENDPOINT", "CALLS", "UNITS"], byEndpoint.map((r) => [String(r.endpoint ?? "?"), num(r.calls), num(r.units)]))
        : "(no calls)",
    );
    const byDay = arr(body.by_day);
    lines.push("", "BY DAY");
    lines.push(
      byDay.length ? table(["DATE", "CALLS", "UNITS"], byDay.map((r) => [String(r.date ?? "?"), num(r.calls), num(r.units)])) : "(no calls)",
    );
    if (body.truncated === true) lines.push("", "The breakdown is truncated. Narrow --from/--to for the full detail.");
    return lines.join("\n");
  });
  return 0;
}
