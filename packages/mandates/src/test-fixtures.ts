// Shared valid objects for tests. Each test copies one and breaks one thing.
import type { CartMandate, IntentMandate } from "./schemas.ts";

export const NOW = new Date("2026-10-20T12:00:00Z");

export function intentMandate(issuer: string, holder: string): IntentMandate {
  return {
    id: "im_1",
    issuer,
    holder,
    payer: "vault_customer_1",
    payee: "merchant_1",
    chargeable_payment_methods: ["vault_token_1"],
    shopping_intent: {
      skus: ["COFFEE-1KG"],
      max_unit_price: { value: "25.00", currency: "USD" },
      max_amount_per_period: { value: "60.00", currency: "USD" },
      period: "P30D",
      max_quantity_per_period: 2,
      merchants: ["merchant_1"],
    },
    prompt_playback: "Reorder 1kg coffee beans, up to $25 each, max $60 and 2 bags per 30 days.",
    notification_policy: { pre_charge_notice_hours: 48 },
    risk_payload: {},
    user_present: false,
    valid_from: "2026-10-14T00:00:00Z",
    expires_at: "2027-10-14T00:00:00Z",
  };
}

export function cartMandate(overrides: Partial<CartMandate> = {}): CartMandate {
  return {
    id: "cm_1",
    intent_mandate_id: "im_1",
    merchant: "merchant_1",
    items: [{ sku: "COFFEE-1KG", qty: 1, unit_price: { value: "22.50", currency: "USD" } }],
    total: { value: "22.50", currency: "USD" },
    timestamp: "2026-10-20T12:00:00Z",
    ...overrides,
  };
}
