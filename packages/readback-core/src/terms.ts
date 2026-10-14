// The terms string (SPEC §4.1): what Maya approves on PayPal's page, stored in the payment
// token's `description` and copied onto every order. One canonical form; anything else is refused.
//
//   RB1 Good Boy Provisions | GBP-SR24 x1/30d | max USD 65.00 | 2026-10-14..2027-03-31 | agent qX7mP2vL9cRt4sYb
import { formatCents, parseCents } from "./money.ts";
import { fail, ok, type Result } from "./result.ts";

export type Terms = {
  merchant: string; // ≤24 chars, single spaces between words
  sku: string; // ≤16 chars, [A-Z0-9-]
  qty: number; // max per order, 1–999
  periodDays: number; // 1–999
  capCents: number; // per order, USD
  start: string; // YYYY-MM-DD, from 00:00:00 UTC
  end: string; // YYYY-MM-DD, through 23:59:59.999 UTC
  fingerprint: string; // first 16 chars of the agent key's RFC 7638 thumbprint
};

export const TERMS_MAX_LENGTH = 127;
const WORD = "[A-Za-z0-9&'.,-]+";
const MERCHANT = new RegExp(`^(?=.{1,24}$)${WORD}( ${WORD})*$`);
const TERMS = new RegExp(
  "^RB1 (.+?) \\| ([A-Z0-9-]{1,16}) x([1-9]\\d{0,2})/([1-9]\\d{0,2})d \\| max USD (\\S+) \\| " +
    "(\\d{4}-\\d{2}-\\d{2})\\.\\.(\\d{4}-\\d{2}-\\d{2}) \\| agent ([A-Za-z0-9_-]{16})$",
);
const DAY_SEC = 86_400;

// "2026-10-14" -> seconds since 1970 at 00:00:00 UTC, or null if not a real calendar date.
export function dateToEpochSec(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === date ? ms / 1000 : null; // rejects 2026-02-30
}

export function formatTerms(t: Terms): string {
  return `RB1 ${t.merchant} | ${t.sku} x${t.qty}/${t.periodDays}d | max USD ${formatCents(t.capCents)} | ${t.start}..${t.end} | agent ${t.fingerprint}`;
}

export function parseTerms(text: string): Result<Terms> {
  if (text.length > TERMS_MAX_LENGTH) return fail("TERMS_TOO_LONG", "The terms are longer than PayPal keeps.");
  const m = TERMS.exec(text);
  if (!m) return fail("TERMS_MALFORMED", "The approved terms aren't in a format Readback can read.");
  const [, merchant, sku, qty, period, cap, start, end, fingerprint] = m as unknown as string[];
  if (!MERCHANT.test(merchant!)) return fail("TERMS_MALFORMED", "The merchant name in the terms isn't valid.");
  const capCents = parseCents(cap!);
  if (capCents === null || capCents === 0) return fail("TERMS_MALFORMED", "The spending cap in the terms isn't valid.");
  const startSec = dateToEpochSec(start!);
  const endSec = dateToEpochSec(end!);
  if (startSec === null || endSec === null || endSec < startSec) {
    return fail("TERMS_MALFORMED", "The dates in the terms aren't valid.");
  }
  const terms: Terms = {
    merchant: merchant!,
    sku: sku!,
    qty: Number(qty),
    periodDays: Number(period),
    capCents,
    start: start!,
    end: end!,
    fingerprint: fingerprint!,
  };
  // The last second of the agreement must still be period 999 or less, so `p` fits three digits.
  if (periodIndex(endExclusiveSec(terms) - 1, terms)! > 999) {
    return fail("TERMS_MALFORMED", "The agreement runs for more than 999 periods.");
  }
  // Canonical form only: the string must be exactly what we'd write ourselves.
  if (formatTerms(terms) !== text) return fail("TERMS_MALFORMED", "The terms aren't in canonical form.");
  return ok(terms);
}

export function startSec(t: Terms): number {
  return dateToEpochSec(t.start)!;
}

// First second *after* the agreement: 00:00:00 UTC the day after the end date.
export function endExclusiveSec(t: Terms): number {
  return dateToEpochSec(t.end)! + DAY_SEC;
}

export function withinDates(timeSec: number, t: Terms): boolean {
  return timeSec >= startSec(t) && timeSec < endExclusiveSec(t);
}

// Period index from SPEC §4.2: p = floor((iat − start) / (periodDays × 86400)) + 1.
// Null before the start. Always computed from the mandate's `iat`, never the capture time (T17).
export function periodIndex(timeSec: number, t: Terms): number | null {
  const elapsed = timeSec - startSec(t);
  if (elapsed < 0) return null;
  return Math.floor(elapsed / (t.periodDays * DAY_SEC)) + 1;
}
