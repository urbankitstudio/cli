/** Left-aligned columns, two spaces apart, no color. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

/** Label/value pairs with the values aligned. Rows with an undefined value are skipped. */
export function fields(pairs: Array<[string, string | undefined | null]>): string {
  const kept = pairs.filter((p): p is [string, string] => p[1] !== undefined && p[1] !== null);
  const width = Math.max(0, ...kept.map(([k]) => k.length + 1));
  return kept.map(([k, v]) => `${(k + ":").padEnd(width)}  ${v}`).join("\n");
}

export function num(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "-";
}

export function yesNo(v: unknown): string {
  return v === true ? "yes" : v === false ? "no" : "-";
}

/** owner_data is true, false, or "mcp-only" (pay-as-you-go: only through the MCP enrich_address tool). */
export function ownerData(v: unknown): string {
  return v === "mcp-only" ? "MCP only" : yesNo(v);
}

function usd(n: number): string {
  return n < 1 ? `$${n}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** {usd_per_month} / {usd_per_unit} / a number / a string, as a person reads a price. */
export function formatPrice(price: unknown): string {
  if (typeof price === "number") return price === 0 ? "free" : usd(price);
  if (typeof price === "string") return price;
  if (price && typeof price === "object") {
    const p = price as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof p.usd_per_month === "number") parts.push(p.usd_per_month === 0 ? "free" : `${usd(p.usd_per_month)}/month`);
    if (typeof p.usd_per_unit === "number") parts.push(`${usd(p.usd_per_unit)}/unit`);
    if (parts.length) return parts.join(" + ");
    return "free";
  }
  return "-";
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}
