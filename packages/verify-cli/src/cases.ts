// Builds the case bundle for /api/cases/[id] (SPEC §5.5, §5.6), live from PayPal, storing nothing.
// The chain is followed through PayPal as far as PayPal goes:
//   dispute → seller_transaction_id → capture → order → token
// The last hop uses PayPal's vault echo if present; the sandbox doesn't send one (spike step 3), so
// the agreement both labels name is used instead, and check 2a only accepts it if PayPal shows that
// agreement belongs to the payer charged.
import {
  type Address,
  agreementFromLabels,
  type CaseBundle,
  CaptureSchema,
  DisputeSchema,
  type HistoryEntry,
  OrderSchema,
  parseTerms,
  PaymentTokenSchema,
  sha256Hex,
  verifyMandate,
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
    .array(z.object({ transaction_info: z.object({ transaction_id: z.string(), transaction_initiation_date: z.string(), custom_field: z.string().optional(), transaction_event_code: z.string().optional(), transaction_status: z.string().optional(), transaction_amount: z.object({ value: z.string() }).optional() }) }))
    .optional(),
});
const DisputeList = z.object({ items: z.array(z.object({ dispute_id: z.string() })).optional() });
// Which purchase unit owns which capture (Readback's own orders have exactly one).
const OrderCaptures = z.object({
  purchase_units: z.array(z.object({ payments: z.object({ captures: z.array(z.object({ id: z.string() })).optional() }).optional() })),
});

// The public case bundle carries no street addresses (audit finding 8). Check 10 only needs to
// know whether the order shipped to the approved address, so each address becomes a SHA-256 of its
// fields; equal addresses give equal hashes, and the browser can still re-run the comparison.
async function hideAddress(a: Address | undefined): Promise<Address | undefined> {
  if (!a) return undefined;
  const fields = [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].map((f) => f ?? "");
  return { address_line_1: `sha256:${await sha256Hex(JSON.stringify(fields))}` };
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 31; // Transaction Search's maximum window
const SEARCH_YEARS = 3; // how far back Transaction Search reaches

// The history walk checks at most this many earlier charges for disputes (see findHistory).
export const HISTORY_LOOKUP_BUDGET = 10;

// A PayPal failure, said plainly: rate limiting isn't "not found".
function failed(status: number, notFound: string): CaseLookup {
  if (status === 429) return { ok: false, status: 429, message: "PayPal is rate-limiting requests right now; try again in a minute." };
  return { ok: false, status: status === 404 ? 404 : 502, message: status === 404 ? notFound : "PayPal couldn't be reached for this case." };
}

export async function buildCaseBundle(id: string, paypal: PayPalClient, now: Date): Promise<CaseLookup> {
  // Dispute IDs start with PP-D- or PP-R- (both seen in the sandbox); capture IDs never start with
  // PP-, so anything else is treated as a capture ID (preview mode).
  let dispute: CaseBundle["dispute"] = null;
  let captureId = id;
  if (id.startsWith("PP-")) {
    const d = await paypal.get(`/v1/customer/disputes/${encodeURIComponent(id)}`, DisputeSchema);
    if (!d.ok) return failed(d.status, "Dispute not found at PayPal.");
    dispute = d.data;
    const txn = d.data.disputed_transactions?.find((t) => t.seller_transaction_id)?.seller_transaction_id;
    if (!txn) return { ok: false, status: 422, message: "The dispute names no seller transaction." };
    captureId = txn;
  }

  const cap = await paypal.get(`/v2/payments/captures/${encodeURIComponent(captureId)}`, CaptureWithOrder);
  if (!cap.ok) return failed(cap.status, "Charge not found at PayPal.");
  const orderId = cap.data.supplementary_data?.related_ids?.order_id;
  if (!orderId) return { ok: false, status: 422, message: "PayPal doesn't link this charge to an order." };

  const raw = await paypal.get(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, z.unknown());
  if (!raw.ok) return failed(raw.status, "Order not found at PayPal.");
  const order = raw.ok ? OrderSchema.safeParse(raw.data) : null;
  const owners = raw.ok ? OrderCaptures.safeParse(raw.data) : null;
  if (!order?.success || !owners?.success) return { ok: false, status: 502, message: "Order not found at PayPal." };
  // Evaluate the purchase unit that owns THIS capture, not just the first one (audit finding 7).
  const owner = owners.data.purchase_units.findIndex((p) => p.payments?.captures?.some((c) => c.id === captureId));
  if (owner < 0) return { ok: false, status: 422, message: "PayPal's order doesn't contain this charge." };
  const orderData = { ...order.data, purchase_units: [order.data.purchase_units[owner]!] as typeof order.data.purchase_units };

  const pu0 = orderData.purchase_units[0]!;
  const tokenId = orderData.payment_source?.paypal?.attributes?.vault?.id ?? agreementFromLabels(pu0.custom_id, pu0.invoice_id);
  let token: CaseBundle["token"] = null;
  if (tokenId) {
    const t = await paypal.get(`/v3/vault/payment-tokens/${encodeURIComponent(tokenId)}`, PaymentTokenSchema);
    if (t.ok) token = t.data;
    else if (t.status !== 404) return failed(t.status, "Agreement lookup failed at PayPal.");
  }

  // Same rule as the checks: the order's copy of the terms is used only if PayPal's token is gone.
  const termsText = token ? token.payment_source.paypal.description : orderData.purchase_units[0]?.description;
  const terms = termsText ? parseTerms(termsText) : null;
  const payerId = token?.payment_source.paypal.payer_id ?? orderData.payer?.payer_id ?? orderData.payment_source?.paypal?.account_id;
  const history = tokenId && terms?.ok
    ? await findHistory(paypal, tokenId, new Date(`${terms.value.start}T00:00:00Z`), now, { checkDisputes: true, verifyPayer: payerId, fingerprint: terms.value.fingerprint, before: cap.data.create_time })
    : { entries: [], complete: true, limited: false };

  const { supplementary_data: _s, ...capture } = cap.data;
  const pu = orderData.purchase_units[0]!;
  if (pu.shipping) pu.shipping = { ...pu.shipping, address: await hideAddress(pu.shipping.address) };
  const tokenShipping = token?.payment_source.paypal.shipping;
  if (token && tokenShipping) token.payment_source.paypal.shipping = { ...tokenShipping, address: await hideAddress(tokenShipping.address) };
  return {
    ok: true,
    bundle: {
      dispute,
      capture,
      order: orderData,
      token,
      // ponytail: deletion events need a registered webhook and the spike's step 5 answer;
      // until then a deleted token is detected by its 404 (and PayPal refuses charges on it).
      tokenDeletedAt: null,
      history: history.entries,
      historyComplete: history.complete,
      historyLimited: history.limited,
      now: now.toISOString(),
    },
  };
}

// Other charges under this agreement: Transaction Search filtered client-side on the
// custom_field prefix rb1:<tokenId>: (SPEC §5.3a), then each one's dispute status. Labels are
// merchant-written, so with `verifyPayer` each candidate is confirmed through PayPal itself:
// its order was paid with this agreement's saved wallet, by the same payer, and completed.
export async function findHistory(
  paypal: PayPalClient,
  tokenId: string,
  start: Date,
  now: Date,
  opts: { checkDisputes: boolean; verifyPayer?: string | undefined; fingerprint?: string; before?: string },
): Promise<{ entries: HistoryEntry[]; complete: boolean; limited: boolean }> {
  const prefix = `rb1:${tokenId}:`;
  const entries: HistoryEntry[] = [];
  // Transaction Search keeps three years. Starting earlier would only spend calls on empty windows,
  // and fewer entries can only make the history check stricter, never pass it.
  const earliest = Math.max(start.getTime(), now.getTime() - SEARCH_YEARS * 365 * DAY_MS);
  for (let from = earliest; from < now.getTime(); from += WINDOW_DAYS * DAY_MS) {
    const to = Math.min(from + WINDOW_DAYS * DAY_MS, now.getTime());
    for (let page = 1; ; page++) {
      const q = new URLSearchParams({ start_date: new Date(from).toISOString(), end_date: new Date(to).toISOString(), fields: "transaction_info", page_size: "500", page: String(page) });
      const res = await paypal.get(`/v1/reporting/transactions?${q}`, Search);
      // A failed search means the history is incomplete; the checks treat that as provisional,
      // so missing history can never pass a check by accident (audit finding 3).
      if (!res.ok) return { entries, complete: false, limited: false };
      for (const { transaction_info: t } of res.data.transaction_details ?? []) {
        // Only payments count as charges: T00xx (vault charges are T0003, buyer-present T0006), never a
        // denied one (status D). PayPal also writes non-payment rows carrying the charge's labels (a
        // dispute's T1110 hold and T1111 release, spike step 6; chargebacks, holds), and a declined
        // attempt doesn't burn the invoice (spike step 4): counting those would rule against an honest
        // charge (audit Oct 25). The 31-day windows share an edge, so each capture is kept once.
        const payment = t.transaction_event_code?.startsWith("T00") && t.transaction_status !== "D";
        if (t.custom_field?.startsWith(prefix) && payment && !entries.some((e) => e.captureId === t.transaction_id)) {
          entries.push({ captureId: t.transaction_id, captureTime: t.transaction_initiation_date, customId: t.custom_field, amount: t.transaction_amount?.value, disputed: false, verified: false });
        }
      }
      if (page >= (res.data.total_pages ?? 1)) break;
    }
  }
  // Check 11 needs two undisputed, PayPal-verified captures before the disputed one, the earliest
  // 7+ days back. Oldest first, stop once two qualify: a few PayPal calls instead of two per charge.
  // Entries left unchecked stay unverified, so they can never count FOR the merchant; checks 3 and 7
  // still read every entry's labels, so they can still count AGAINST it.
  const candidates = entries
    .filter((h) => opts.before === undefined || Date.parse(h.captureTime) < Date.parse(opts.before))
    .sort((a, b) => Date.parse(a.captureTime) - Date.parse(b.captureTime));
  // A bounded walk: under a dispute flood most earlier charges are disputed and never qualify, so
  // an unbounded walk costs one PayPal call per earlier charge for every case (audit: flood, Oct 26).
  // Past the budget, history is "not established within the limit": check 11 then fails, which can
  // only withhold a seller-favor suggestion, never create one.
  let qualified = 0;
  let lookups = 0;
  let limited = false;
  for (const h of opts.verifyPayer ? candidates : entries) {
    if (opts.checkDisputes && ++lookups > HISTORY_LOOKUP_BUDGET) {
      limited = qualified < 2;
      break;
    }
    if (opts.checkDisputes) {
      const d = await paypal.get(`/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(h.captureId)}`, DisputeList);
      // Unknown dispute status counts as disputed: it must not help the merchant (fail closed).
      h.disputed = !d.ok || (d.data.items?.length ?? 0) > 0;
    }
    if (opts.verifyPayer && !h.disputed) {
      h.verified = await paidWithThisAgreement(paypal, h.captureId, tokenId, opts.verifyPayer, opts.fingerprint);
      if (h.verified && ++qualified >= 2) break;
    }
  }
  return { entries, complete: true, limited };
}

// Labels alone are merchant-written, so a history entry counts only if PayPal shows the same payer
// and either PayPal's echo names this agreement or the order carries a request signed by the
// approved agent key for this agreement (which only her agent can produce).
async function paidWithThisAgreement(paypal: PayPalClient, captureId: string, tokenId: string, payerId: string, fingerprint: string | undefined): Promise<boolean> {
  const cap = await paypal.get(`/v2/payments/captures/${encodeURIComponent(captureId)}`, CaptureWithOrder);
  const orderId = cap.ok ? cap.data.supplementary_data?.related_ids?.order_id : undefined;
  // A refunded prior charge isn't evidence she accepted it, so only fully completed ones qualify.
  if (!cap.ok || !orderId || cap.data.status !== "COMPLETED") return false;
  const raw = await paypal.get(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, z.unknown());
  const order = raw.ok ? OrderSchema.safeParse(raw.data) : null;
  const owners = raw.ok ? OrderCaptures.safeParse(raw.data) : null;
  if (!order?.success || !owners?.success) return false;
  const o = order.data;
  if ((o.payer?.payer_id ?? o.payment_source?.paypal?.account_id) !== payerId) return false;
  const echo = o.payment_source?.paypal?.attributes?.vault?.id;
  if (echo !== undefined) return echo === tokenId;
  const pu = o.purchase_units[owners.data.purchase_units.findIndex((p) => p.payments?.captures?.some((c) => c.id === captureId))];
  const jws = pu?.items?.[0]?.description;
  if (!fingerprint || !jws) return false;
  const m = await verifyMandate(jws);
  return m.ok && m.value.fingerprint === fingerprint && m.value.payload.agr === tokenId;
}
