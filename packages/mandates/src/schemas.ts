// AP2-shaped mandates (field names follow AP2 where it defines them). See docs/SPEC.md §4.
// Every object is strict: an unknown field is a parse error, and a parse error is a deny.
import { z } from "zod";

// Money as PayPal sends it: a decimal string, never a float (0.1 + 0.2 !== 0.3).
export const MoneySchema = z.strictObject({
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof MoneySchema>;

const did = z.string().startsWith("did:");

export const IntentMandateSchema = z.strictObject({
  id: z.string().min(1),
  issuer: did, // shopper
  holder: did, // agent
  payer: z.string().min(1), // PayPal vault customer ID
  payee: z.string().min(1), // merchant ID
  chargeable_payment_methods: z.array(z.string().min(1)).min(1), // vault token IDs, never secrets
  shopping_intent: z.strictObject({
    skus: z.array(z.string().min(1)).min(1),
    max_unit_price: MoneySchema,
    max_amount_per_period: MoneySchema,
    period: z.string().regex(/^P(\d+D|\d+W|\d+M)$/), // ISO 8601 subset: P30D, P2W, P1M
    max_quantity_per_period: z.number().int().positive(),
    merchants: z.array(z.string().min(1)).min(1),
  }),
  prompt_playback: z.string().min(1),
  notification_policy: z.strictObject({ pre_charge_notice_hours: z.number().int().nonnegative() }),
  risk_payload: z.record(z.string(), z.unknown()),
  user_present: z.literal(false),
  valid_from: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export type IntentMandate = z.infer<typeof IntentMandateSchema>;

export const CartItemSchema = z.strictObject({
  sku: z.string().min(1),
  qty: z.number().int().positive(),
  unit_price: MoneySchema,
});
export type CartItem = z.infer<typeof CartItemSchema>;

export const CartMandateSchema = z.strictObject({
  id: z.string().min(1),
  intent_mandate_id: z.string().min(1),
  merchant: z.string().min(1),
  items: z.array(CartItemSchema).min(1),
  total: MoneySchema,
  timestamp: z.iso.datetime(),
});
export type CartMandate = z.infer<typeof CartMandateSchema>;

export const PaymentMandateSchema = z.strictObject({
  payment_mandate_id: z.string().min(1),
  cart_mandate_id: z.string().min(1),
  total: MoneySchema,
  agent_presence: z.literal(true),
  modality: z.literal("HUMAN_NOT_PRESENT"),
  order_id: z.string().optional(),
  capture_id: z.string().optional(),
});
export type PaymentMandate = z.infer<typeof PaymentMandateSchema>;

// "12.5" -> 1250. Integer cents so comparisons are exact.
export function toCents(m: Money): number {
  const [whole, frac = ""] = m.value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
