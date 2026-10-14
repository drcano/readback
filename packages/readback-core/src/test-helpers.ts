// Shared test data. The story mandate from SPEC §2, with a fixed fake fingerprint.
import type { Terms } from "./terms.ts";

export const STORY_TERMS: Terms = {
  merchant: "Good Boy Provisions",
  sku: "GBP-SR24",
  qty: 1,
  periodDays: 30,
  capCents: 6500,
  start: "2026-10-14",
  end: "2027-03-31",
  fingerprint: "qX7mP2vL9cRt4sYb",
};

export const STORY_TERMS_STRING =
  "RB1 Good Boy Provisions | GBP-SR24 x1/30d | max USD 65.00 | 2026-10-14..2027-03-31 | agent qX7mP2vL9cRt4sYb";

export const sec = (iso: string): number => Date.parse(iso) / 1000;
