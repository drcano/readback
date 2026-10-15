// Plain-language wording for the investigator UI. Display only: code keeps PayPal's real enums
// and readback-core's codes; these never feed a decision.
import type { Light } from "@readback/core";

const REASONS: Record<string, string> = {
  UNAUTHORISED: "Unauthorized",
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  INCORRECT_AMOUNT: "Incorrect amount",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  CANCELED_RECURRING_BILLING: "Canceled recurring billing",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  PROBLEM_WITH_REMITTANCE: "Remittance problem",
};

// What the shopper is saying, in her words.
const CLAIMS: Record<string, string> = {
  UNAUTHORISED: "“I didn't make this purchase.”",
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "“It never arrived.”",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "“It's not what I ordered.”",
  INCORRECT_AMOUNT: "“I was charged the wrong amount.”",
  DUPLICATE_TRANSACTION: "“I was charged twice.”",
  CANCELED_RECURRING_BILLING: "“I cancelled, and they kept charging.”",
};

// "CHARGEBACK" → "Chargeback"; unknown values stay readable instead of disappearing.
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

export const reasonLabel = (reason: string): string => REASONS[reason] ?? titleCase(reason);
export const claimQuote = (reason: string): string => CLAIMS[reason] ?? `“${reasonLabel(reason)}.”`;
export const stageLabel = (stage: string): string => (stage ? titleCase(stage) : "—");

export type Rec = { key: "uphold" | "refund" | "review"; label: string };
export function recommendation(s: "BUYER_FAVOR" | "SELLER_FAVOR" | null): Rec {
  if (s === "SELLER_FAVOR") return { key: "uphold", label: "Uphold the charge" };
  if (s === "BUYER_FAVOR") return { key: "refund", label: "Refund the buyer" };
  return { key: "review", label: "Needs review" };
}

// The four evidence steps, short (queue chips) and long (case view headings).
const STEP: Record<Light["group"], { short: string; pass: string; fail: string; caution: string }> = {
  Consent: { short: "She approved", pass: "She approved her agent's limits on PayPal", fail: "Her approval doesn't cover this charge", caution: "Her approval is only partly verified" },
  Agent: { short: "Her agent asked", pass: "Her agent asked for this order", fail: "Her agent did not ask for this order", caution: "Her agent's request is only partly verified" },
  Terms: { short: "Within limits", pass: "The charge stayed within her limits", fail: "The charge broke her limits", caution: "Within her limits, not fully verified yet" },
  Delivery: { short: "Delivered", pass: "It shipped to her address", fail: "Delivery isn't shown", caution: "Delivery is only partly shown" },
};
export const stepShort = (g: Light["group"]): string => STEP[g].short;
export const stepTitle = (l: Light): string => STEP[l.group][l.state];
