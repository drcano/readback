// Dispute drafts (SPEC §7). Generated from the case facts by code, so every statement is true by
// construction; Sam approves before anything is sent (nothing is ever auto-sent).
//  - SELLER_FAVOR rows: the "inquiry first" message, Maya's own approval read back to her.
//  - BUYER_FAVOR rows: a courteous refund note.
//  - no suggestion: no draft; flag for review.
import { type CaseBundle, type CaseResult, formatCents } from "@readbackhq/core";
import { CATALOG } from "./catalog";
import { cadence } from "./readback-card";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

// Why the charge shouldn't stand, in Maya's words, per buyer-favor classification row.
const REFUND_WHY: Record<string, string> = {
  CHARGED_AFTER_REVOCATION: "was made after you cancelled your agreement",
  NO_VALID_AGENT_REQUEST: "wasn't requested by your agent",
  OUTSIDE_TERMS: "fell outside the terms you approved",
  NON_FULFILLMENT: "has no record of being shipped",
};

export type Draft = { kind: "inquiry" | "refund" | "none"; text: string };

export function draftMessage(bundle: CaseBundle, result: CaseResult): Draft {
  const { terms, mandate } = result.facts;
  const s = result.classification.suggestion;
  if (s === "BUYER_FAVOR") {
    return {
      kind: "refund",
      text: `We're sorry. We reviewed this charge (${bundle.capture.id}, USD ${bundle.capture.amount.value}): it ${REFUND_WHY[result.classification.code] ?? "shouldn't have happened"}. We'll refund it in full.`,
    };
  }
  if (s !== "SELLER_FAVOR" || !terms || !mandate) {
    return { kind: "none", text: "No draft: the evidence doesn't support a suggested outcome. Flagged for review." };
  }
  const item = CATALOG[terms.sku]?.name ?? terms.sku;
  const earlier = bundle.history.filter((h) => h.captureId !== bundle.capture.id && Date.parse(h.captureTime) < Date.parse(bundle.capture.create_time)).length;
  return {
    kind: "inquiry",
    text: [
      `Your agreement, approved on PayPal and active from ${day(`${terms.start}T00:00:00Z`)}, lets your agent buy up to ${terms.qty} × ${item} ${cadence(terms.periodDays)}, up to $${formatCents(terms.capCents)} per order, until ${day(`${terms.end}T00:00:00Z`)}, and only when your agent asks.`,
      `This order was requested and signed by that agent on ${day(new Date(mandate.payload.iat * 1000).toISOString())}. It was charge ${earlier + 1} under that agreement.`,
      `If you'd like your agent to stop, you can cancel any time in PayPal › Settings › Payments › Manage automatic payments, or ask your agent to revoke the agreement.`,
    ].join("\n\n"),
  };
}
