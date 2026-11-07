// Fixed-point decimals on BigInt. No floats are used anywhere in money maths.

export const SCALE = { qty: 3, price: 6, pct: 2, money: 3 };

// Parses a non-negative decimal string to a BigInt scaled by 10^scale.
// Returns null when the text is not a number or has more decimals than the scale.
export function parseDecimal(text, scale) {
  const s = String(text ?? "").trim().replace(/,/g, "");
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  const [whole = "", frac = ""] = s.split(".");
  if (frac.length > scale) return null;
  return BigInt((whole || "0") + frac.padEnd(scale, "0"));
}

// Divides and rounds half away from zero. The divisor must be positive.
export function roundDiv(n, d) {
  const negative = n < 0n;
  const a = negative ? -n : n;
  const q = a / d;
  const rounded = (a % d) * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

export function formatDecimal(n, scale, { minFraction = scale, group = false } = {}) {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(scale + 1, "0");
  let whole = digits.slice(0, digits.length - scale);
  let frac = digits.slice(digits.length - scale);
  while (frac.length > minFraction && frac.endsWith("0")) frac = frac.slice(0, -1);
  if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + whole + (frac ? "." + frac : "");
}

export const formatMoney = (n) => formatDecimal(n, SCALE.money, { group: true });
export const formatQty = (n) => formatDecimal(n, SCALE.qty);
export const formatPct = (n) => formatDecimal(n, SCALE.pct, { minFraction: 0 });
