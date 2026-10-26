// The case bundle: exactly the PayPal fields the eleven checks read, nothing more (SPEC §5.10
// /api/cases/[id]). The server fetches it; the browser can re-run every check on it.
//
// These schemas are *not* strict, unlike Readback's own formats: PayPal may add fields at any time,
// and an unknown PayPal field is not an attack. Missing fields we need still fail closed.
// Field paths come from PayPal's OpenAPI specs (github.com/paypal/paypal-rest-api-specifications).
import { z } from "zod";

const Money = z.object({ currency_code: z.string(), value: z.string() });

export const AddressSchema = z.object({
  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  admin_area_2: z.string().optional(),
  admin_area_1: z.string().optional(),
  postal_code: z.string().optional(),
  country_code: z.string().optional(),
});
export type Address = z.infer<typeof AddressSchema>;

// Vault v3 GET /v3/vault/payment-tokens/{id} (payment_token_response)
export const PaymentTokenSchema = z.object({
  id: z.string(),
  payment_source: z.object({
    paypal: z.object({
      description: z.string().optional(), // the approved terms string
      payer_id: z.string().optional(),
      shipping: z.object({ name: z.object({ full_name: z.string().optional() }).optional(), address: AddressSchema.optional() }).optional(),
    }),
  }),
});
export type PaymentToken = z.infer<typeof PaymentTokenSchema>;

const BreakdownSchema = z.object({
  item_total: Money.optional(),
  shipping: Money.optional(),
  handling: Money.optional(),
  tax_total: Money.optional(),
  insurance: Money.optional(),
  shipping_discount: Money.optional(),
  discount: Money.optional(),
});

// Orders v2 GET /v2/checkout/orders/{id} (order)
export const OrderSchema = z.object({
  id: z.string(),
  payer: z.object({ payer_id: z.string().optional() }).optional(),
  payment_source: z
    .object({
      paypal: z
        .object({
          account_id: z.string().optional(),
          // PayPal-attested: which saved wallet paid. The one link the merchant can't fake.
          attributes: z.object({ vault: z.object({ id: z.string().optional() }).optional() }).optional(),
          // Merchant-declared. Shown, never decisive.
          stored_credential: z.object({ payment_initiator: z.string().optional(), usage: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        description: z.string().optional(), // secondary copy of the terms
        custom_id: z.string().optional(),
        invoice_id: z.string().optional(),
        amount: Money.extend({ breakdown: BreakdownSchema.optional() }),
        items: z
          .array(
            z.object({
              name: z.string(),
              sku: z.string().optional(),
              quantity: z.string(),
              unit_amount: Money,
              description: z.string().optional(), // the agent-signed mandate (compact JWS)
            }),
          )
          .optional(),
        shipping: z
          .object({
            address: AddressSchema.optional(),
            trackers: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});
export type Order = z.infer<typeof OrderSchema>;

// Payments v2 GET /v2/payments/captures/{id}
export const CaptureSchema = z.object({
  id: z.string(),
  status: z.string(),
  status_details: z.object({ reason: z.string().optional() }).optional(),
  amount: Money,
  create_time: z.string(),
  custom_id: z.string().optional(),
  invoice_id: z.string().optional(),
  seller_protection: z
    .object({ status: z.string().optional(), dispute_categories: z.array(z.string()).optional() })
    .optional(),
});
export type Capture = z.infer<typeof CaptureSchema>;

export const DISPUTE_REASONS = [
  "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  "UNAUTHORISED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE_TRANSACTION",
  "INCORRECT_AMOUNT",
  "PAYMENT_BY_OTHER_MEANS",
  "CANCELED_RECURRING_BILLING",
  "PROBLEM_WITH_REMITTANCE",
  "OTHER",
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

// Disputes v1 GET /v1/customer/disputes/{id}
export const DisputeSchema = z.object({
  dispute_id: z.string(),
  reason: z.enum(DISPUTE_REASONS),
  status: z.string(),
  dispute_life_cycle_stage: z.string(),
  create_time: z.string().optional(),
  seller_response_due_date: z.string().optional(),
  update_time: z.string().optional(),
  // Present once PayPal has decided (status RESOLVED). Shown, never used by the checks.
  dispute_outcome: z.object({ outcome_code: z.string(), outcome_reason: z.string().optional() }).optional(),
  disputed_transactions: z
    .array(
      z.object({
        seller_transaction_id: z.string().optional(),
        custom: z.string().optional(),
        invoice_number: z.string().optional(),
      }),
    )
    .optional(),
});
export type Dispute = z.infer<typeof DisputeSchema>;

// One other capture under the same agreement, found through Transaction Search by the
// rb1:<tokenId>: prefix on custom_field, with its dispute status looked up separately.
export const HistoryEntrySchema = z.object({
  captureId: z.string(),
  captureTime: z.string(),
  customId: z.string().optional(),
  amount: z.string().optional(), // USD as PayPal reports it; for display, never compared
  disputed: z.boolean(),
  // PayPal-verified: this capture's order was paid with THIS agreement's saved wallet (vault echo),
  // by the same payer, and completed. Labels alone are merchant-written, so only verified entries
  // can count as history (audit finding 2).
  verified: z.boolean(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const CaseBundleSchema = z.object({
  dispute: DisputeSchema.nullable(), // null = preview mode ("check this charge")
  capture: CaptureSchema,
  order: OrderSchema,
  token: PaymentTokenSchema.nullable(), // null = GET returned 404 (agreement deleted)
  tokenDeletedAt: z.string().nullable(), // from VAULT.PAYMENT-TOKEN.DELETED, if retrievable
  history: z.array(HistoryEntrySchema),
  historyComplete: z.boolean(), // false if Transaction Search failed or was cut short
  historyLimited: z.boolean().optional(), // the dispute lookups hit their budget before two charges qualified
  now: z.string(), // when the bundle was fetched
});
export type CaseBundle = z.infer<typeof CaseBundleSchema>;
