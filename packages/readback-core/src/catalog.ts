// Good Boy Provisions' catalog (a fictional shop): one source for the merchant app (item names and
// the price its gate expects) and the agent runtime (the price it signs). A mismatch would make the
// gate refuse every purchase, so there is exactly one copy.
export const MERCHANT_NAME = "Good Boy Provisions";

export const CATALOG: Record<string, { name: string; unitCents: number }> = {
  "GBP-SR24": { name: "Salmon & Rice Adult (24 lb)", unitCents: 6499 },
  "GBP-SR12": { name: "Salmon & Rice Adult (12 lb)", unitCents: 3899 },
  "GBP-PREMIUM": { name: "Premium Bundle (salmon, treats, toys)", unitCents: 14999 },
};
