// Money is parsed into integer cents and only integers are compared (SPEC §4.2).
// "64.99" -> 6499. Strings like "65" or "065.00" are refused, not normalized: fail closed.
const MONEY = /^(0|[1-9]\d{0,3})\.\d{2}$/; // 0.00 to 9999.99

export function parseCents(value: string): number | null {
  if (!MONEY.test(value)) return null;
  const [whole, frac] = value.split(".") as [string, string];
  return Number(whole) * 100 + Number(frac);
}

export function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
