// The checkout gate (SPEC §5.3): verify → GET the agreement → decide (readback-core) → charge.
// Stateless and fail-closed. Every decision comes from authorizeCharge; this file only does I/O.
import {
  authorizeCharge,
  checkFreshness,
  denialFromPayPalIssue,
  type Failure,
  parseCents,
  PaymentTokenSchema,
  verifyMandate,
} from "@readback/core";
import { z } from "zod";
import { CATALOG, MERCHANT_NAME } from "./catalog";
import type { PayPalClient } from "./paypal/client";

export type CheckoutResult =
  | { ok: true; orderId: string; captureId: string; invoiceId: string }
  | { ok: false; status: number; failures: Failure[] };

const OrderCreated = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(z.object({ payments: z.object({ captures: z.array(z.object({ id: z.string(), status: z.string() })).optional() }).optional() }))
    .optional(),
});

const deny = (status: number, ...failures: Failure[]): CheckoutResult => ({ ok: false, status, failures });

export async function checkout(jws: string, paypal: PayPalClient, nowSec: number): Promise<CheckoutResult> {
  // 1. Signature and freshness before any PayPal call.
  const verified = await verifyMandate(jws);
  if (!verified.ok) return deny(400, verified.error);
  const stale = checkFreshness(verified.value.payload, nowSec);
  if (stale.length > 0) return deny(400, ...stale);
  const { agr, sku, unit } = verified.value.payload;

  const item = CATALOG[sku];
  if (!item) return deny(422, { code: "UNKNOWN_ITEM", message: "That item isn't sold here." });
  // The merchant's own protection: the signed price must be today's catalog price, so an agent
  // talked into a fake "sale" price can't produce an underpaid order.
  if (parseCents(unit) !== item.unitCents) return deny(422, { code: "PRICE_CHANGED", message: "The price changed since your agent checked; ask it again." });

  // 2. The agreement as PayPal holds it right now. 404 = cancelled.
  const tok = await paypal.get(`/v3/vault/payment-tokens/${encodeURIComponent(agr)}`, PaymentTokenSchema);
  if (!tok.ok && tok.status !== 404) return deny(502, { code: "PAYPAL_UNAVAILABLE", message: "PayPal couldn't be reached; nothing was charged." });

  // 3–5. The decision.
  const decision = await authorizeCharge({ jws, token: tok.ok ? tok.data : null, merchant: MERCHANT_NAME, itemName: item.name, nowSec });
  if (!decision.allow) return deny(422, ...decision.failures);

  // 6. Charge the saved wallet. PayPal's refusals become the same plain-language denials.
  const created = await paypal.post("/v2/checkout/orders", decision.requestIds.create, decision.orderRequest, OrderCreated);
  if (!created.ok) return deny(422, ...created.issues.map(denialFromPayPalIssue));

  let order = created.data;
  if (order.status !== "COMPLETED") {
    const captured = await paypal.post(`/v2/checkout/orders/${order.id}/capture`, decision.requestIds.capture, {}, OrderCreated);
    // A failed capture is a denial; the order is left uncaptured (SPEC §5.3).
    if (!captured.ok) return deny(422, ...captured.issues.map(denialFromPayPalIssue));
    order = captured.data;
  }
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  // PENDING: PayPal holds the charge for review, and this period's invoice is used, so say so rather
  // than "not completed". Asking again can't charge twice (DUPLICATE_INVOICE_ID).
  if (capture?.status === "PENDING") {
    return deny(422, { code: "CAPTURE_PENDING", message: "PayPal is holding this charge for review. It may still go through; asking again won't charge twice." });
  }
  if (!capture || capture.status !== "COMPLETED") {
    const declined = capture?.status === "DECLINED" || capture?.status === "FAILED";
    return deny(422, { code: "CAPTURE_NOT_COMPLETED", message: declined ? "PayPal declined the charge; nothing was charged." : "PayPal didn't complete the charge." });
  }
  return { ok: true, orderId: order.id, captureId: capture.id, invoiceId: decision.invoiceId };
}
