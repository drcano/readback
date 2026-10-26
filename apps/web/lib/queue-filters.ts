// The questions an investigator can ask the queue, as deterministic filters (SPEC §5.6 "Studio
// Agent"). Claude may pick WHICH filter a question means; the filter itself is plain code over the
// computed results, so Claude never decides which cases match.
import type { QueueRow } from "./queue";

const light = (r: QueueRow, group: string) => r.lights.find((l) => l.group === group)?.state;

export const FILTERS = {
  merchant_should_lose: { label: "cases the merchant should lose (suggested buyer's favor)", match: (r: QueueRow) => r.suggestion === "BUYER_FAVOR" },
  merchant_should_win: { label: "cases suggested for the seller", match: (r: QueueRow) => r.suggestion === "SELLER_FAVOR" },
  no_suggestion: { label: "cases with no suggested outcome", match: (r: QueueRow) => r.suggestion === null && r.loaded },
  consent_unverified: { label: "cases where consent authenticity is unverified", match: (r: QueueRow) => r.row === 12 },
  agent_failed: { label: "cases with no valid request from the shopper's agent", match: (r: QueueRow) => light(r, "Agent") === "fail" },
  failed_only_delivery: {
    label: "cases that failed only on delivery",
    match: (r: QueueRow) => light(r, "Delivery") === "fail" && ["Consent", "Agent", "Terms"].every((g) => light(r, g) !== "fail"),
  },
  secondary_terms: { label: "cases relying on the merchant's copy of the terms", match: (r: QueueRow) => r.evidence !== "PayPal terms" },
  live_only: { label: "live sandbox disputes", match: (r: QueueRow) => r.source === "Live" },
  all: { label: "all cases", match: () => true },
} as const;

export type FilterId = keyof typeof FILTERS;
export const FILTER_IDS = Object.keys(FILTERS) as FilterId[];

// Keyword fallback, used when Claude isn't configured or declines. Order matters: most specific first.
const KEYWORDS: [RegExp, FilterId][] = [
  [/only.*deliver|deliver.*only/i, "failed_only_delivery"],
  [/unverified|authentic/i, "consent_unverified"],
  [/\blos(e|es|ing)\b|refund|buyer/i, "merchant_should_lose"],
  [/\bwins?\b|\bwinning\b|seller/i, "merchant_should_win"],
  [/no suggestion|undecided|unclear/i, "no_suggestion"],
  [/agent|unsigned|signature|direct/i, "agent_failed"],
  [/secondary|deleted|merchant copy/i, "secondary_terms"],
  [/live|real|sandbox/i, "live_only"],
];

export function keywordFilter(question: string): FilterId {
  return KEYWORDS.find(([re]) => re.test(question))?.[1] ?? "all";
}

export function answer(id: FilterId, rows: QueueRow[]): { count: number; text: string } {
  const count = rows.filter(FILTERS[id].match).length;
  return { count, text: `${count} of ${rows.length}: ${FILTERS[id].label}.` };
}
