// Plain-language names for PayPal's dispute enums, for display only. Code keeps the real enums.
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

// "CHARGEBACK" → "Chargeback"; unknown values stay readable instead of disappearing.
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

export const reasonLabel = (reason: string): string => REASONS[reason] ?? titleCase(reason);
export const stageLabel = (stage: string): string => (stage ? titleCase(stage) : "—");

export const VERDICT = {
  BUYER_FAVOR: "Buyer's favor",
  SELLER_FAVOR: "Seller's favor",
} as const;
export const verdictLabel = (s: keyof typeof VERDICT | null): string => (s ? VERDICT[s] : "No suggestion");
