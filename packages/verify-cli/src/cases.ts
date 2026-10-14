// Builds the case bundle for /api/cases/[id] (SPEC §5.5, §5.6), live from PayPal, storing nothing.
// The chain is followed through PayPal, never through merchant labels (CLAUDE.md §5):
//   dispute → seller_transaction_id → capture → order → payment_source.paypal.attributes.vault.id → token
import {
  type CaseBundle,
  CaptureSchema,
  DisputeSchema,
  type HistoryEntry,
  OrderSchema,
  parseTerms,
  PaymentTokenSchema,
} from "@readback/core";
import { z } from "zod";
import type { PayPalClient } from "./paypal-client.ts";

export type CaseLookup = { ok: true; bundle: CaseBundle } | { ok: false; status: number; message: string };

const CaptureWithOrder = CaptureSchema.extend({
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
});
const Search = z.object({
  total_pages: z.number().optional(),
  transaction_details: z
    .array(z.object({ transaction_info: z.object({ transaction_id: z.string(), transaction_initiation_date: z.string(), custom_field: z.string().optional(), transaction_event_code: z.string().optional() }) }))
    .optional(),
});
const DisputeList = z.object({ items: z.array(z.object({ dispute_id: z.string() })).optional() });

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 31; // Transaction Search's maximum window

export async function buildCaseBundle(id: string, paypal: PayPalClient, now: Date): Promise<CaseLookup> {
  // Dispute IDs start with PP-D-; anything else is treated as a capture ID (preview mode).
  let dispute: CaseBundle["dispute"] = null;
  let captureId = id;
  if (id.startsWith("PP-D-")) {
    const d = await paypal.get(`/v1/customer/disputes/${encodeURIComponent(id)}`, DisputeSchema);
    if (!d.ok) return { ok: false, status: d.status === 404 ? 404 : 502, message: "Dispute not found at PayPal." };
    dispute = d.data;
    const txn = d.data.disputed_transactions?.[0]?.seller_transaction_id;
    if (!txn) return { ok: false, status: 422, message: "The dispute names no seller transaction." };
    captureId = txn;
  }

  const cap = await paypal.get(`/v2/payments/captures/${encodeURIComponent(captureId)}`, CaptureWithOrder);
  if (!cap.ok) return { ok: false, status: cap.status === 404 ? 404 : 502, message: "Charge not found at PayPal." };
  const orderId = cap.data.supplementary_data?.related_ids?.order_id;
  if (!orderId) return { ok: false, status: 422, message: "PayPal doesn't link this charge to an order." };

  const order = await paypal.get(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, OrderSchema);
  if (!order.ok) return { ok: false, status: 502, message: "Order not found at PayPal." };

  const tokenId = order.data.payment_source?.paypal?.attributes?.vault?.id;
  let token: CaseBundle["token"] = null;
  if (tokenId) {
    const t = await paypal.get(`/v3/vault/payment-tokens/${encodeURIComponent(tokenId)}`, PaymentTokenSchema);
    if (t.ok) token = t.data;
    else if (t.status !== 404) return { ok: false, status: 502, message: "Agreement lookup failed at PayPal." };
  }

  const termsText = token?.payment_source.paypal.description ?? order.data.purchase_units[0]?.description;
  const terms = termsText ? parseTerms(termsText) : null;
  const history = tokenId && terms?.ok ? await findHistory(paypal, tokenId, new Date(`${terms.value.start}T00:00:00Z`), now) : [];

  const { supplementary_data: _s, ...capture } = cap.data;
  return {
    ok: true,
    bundle: {
      dispute,
      capture,
      order: order.data,
      token,
      // ponytail: deletion events need a registered webhook and the spike's step 5 answer;
      // until then a deleted token is detected by its 404 (and PayPal refuses charges on it).
      tokenDeletedAt: null,
      history,
      now: now.toISOString(),
    },
  };
}

// Other charges under this agreement: Transaction Search filtered client-side on the
// custom_field prefix rb1:<tokenId>: (SPEC §5.3a), then each one's dispute status.
export async function findHistory(paypal: PayPalClient, tokenId: string, start: Date, now: Date, checkDisputes = true): Promise<HistoryEntry[]> {
  const prefix = `rb1:${tokenId}:`;
  const found: HistoryEntry[] = [];
  for (let from = start.getTime(); from < now.getTime(); from += WINDOW_DAYS * DAY_MS) {
    const to = Math.min(from + WINDOW_DAYS * DAY_MS, now.getTime());
    for (let page = 1; ; page++) {
      const q = new URLSearchParams({ start_date: new Date(from).toISOString(), end_date: new Date(to).toISOString(), fields: "transaction_info", page_size: "500", page: String(page) });
      const res = await paypal.get(`/v1/reporting/transactions?${q}`, Search);
      if (!res.ok) return found; // history is supporting evidence; its absence only lowers the outcome
      for (const { transaction_info: t } of res.data.transaction_details ?? []) {
        // ponytail: excludes refunds by event-code family (T11xx); confirm codes in spike step 6.
        if (t.custom_field?.startsWith(prefix) && !t.transaction_event_code?.startsWith("T11")) {
          found.push({ captureId: t.transaction_id, captureTime: t.transaction_initiation_date, customId: t.custom_field, disputed: false });
        }
      }
      if (page >= (res.data.total_pages ?? 1)) break;
    }
  }
  if (!checkDisputes) return found;
  for (const h of found) {
    const d = await paypal.get(`/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(h.captureId)}`, DisputeList);
    // Unknown dispute status counts as disputed: it must not help the merchant (fail closed).
    h.disputed = !d.ok || (d.data.items?.length ?? 0) > 0;
  }
  return found;
}
