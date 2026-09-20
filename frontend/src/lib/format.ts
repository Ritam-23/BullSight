export function money(v: number | null | undefined, currency?: string | null, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  if (!currency) return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return v.toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits,
  });
}

export function compact(v: number | null | undefined, currency?: string | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    notation: "compact", maximumFractionDigits: 1, ...(currency ? { style: "currency", currency } : {}),
  });
}

export function pct(v: number | null | undefined, digits = 2, signed = true) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Indices are quoted in points, not currency. */
export function priceCurrency(symbol: string, currency?: string | null) {
  return symbol.startsWith("^") ? null : currency ?? null;
}
