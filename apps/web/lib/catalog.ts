// Good Boy Provisions' catalog (a fictional shop). The gate takes item *names* from here;
// SKU, quantity and price always come from the signed mandate and the approved terms.
export const MERCHANT_NAME = "Good Boy Provisions";

export const CATALOG: Record<string, { name: string; unitCents: number }> = {
  "GBP-SR24": { name: "Salmon & Rice Adult (24 lb)", unitCents: 6499 },
  "GBP-SR12": { name: "Salmon & Rice Adult (12 lb)", unitCents: 3899 },
  "GBP-PREMIUM": { name: "Premium Bundle (salmon, treats, toys)", unitCents: 14999 },
};
