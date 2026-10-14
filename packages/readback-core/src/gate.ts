// The checkout gate's decision (SPEC §5.3), as a pure function. The route does the I/O
// (GET the payment token, POST the order); everything that decides allow or deny lives here.
// Fails closed: every path that isn't a clean allow is a denial with plain-language reasons.
import type { PaymentToken } from "./case.ts";
import { sha256Hex } from "./hash.ts";
import { customId, invoiceId, requestIds } from "./ids.ts";
import { checkAgainstTerms, checkFreshness, type MandatePayload, verifyMandate } from "./mandate.ts";
import type { Failure } from "./result.ts";
import { parseTerms, type Terms } from "./terms.ts";

export type GateInput = {
  jws: string; // the agent-signed closed mandate
  token: PaymentToken | null; // GET /v3/vault/payment-tokens/{agr}; null if PayPal said 404
  merchant: string; // this merchant's name as it appears in terms
  itemName: string; // display name from the merchant's catalog (not signed)
  nowSec: number;
};

// The Orders v2 create body, exactly as SPEC §5.3 step 6 defines it.
export type OrderRequest = {
  intent: "CAPTURE";
  payment_source: {
    paypal: {
      vault_id: string;
      stored_credential: { payment_initiator: "MERCHANT"; usage: "SUBSEQUENT"; usage_pattern: "UNSCHEDULED_PREPAID" };
    };
  };
  purchase_units: [
    {
      description: string;
      invoice_id: string;
      custom_id: string;
      amount: { currency_code: "USD"; value: string; breakdown: { item_total: { currency_code: "USD"; value: string } } };
      items: [
        {
          name: string;
          sku: string;
          quantity: string;
          unit_amount: { currency_code: "USD"; value: string };
          description: string;
          category: "PHYSICAL_GOODS";
        },
      ];
    },
  ];
};

export type GateAllow = {
  allow: true;
  mandate: MandatePayload;
  terms: Terms;
  mandateHash: string;
  invoiceId: string;
  customId: string;
  requestIds: { create: string; capture: string; track: string };
  orderRequest: OrderRequest;
};
export type GateDeny = { allow: false; failures: Failure[] };
export type GateDecision = GateAllow | GateDeny;

const deny = (failures: Failure[]): GateDeny => ({ allow: false, failures });

export async function authorizeCharge(input: GateInput): Promise<GateDecision> {
  // 1. Signature and hygiene, before trusting anything in the payload.
  const verified = await verifyMandate(input.jws);
  if (!verified.ok) return deny([verified.error]);
  const { payload: m, fingerprint, mandateHash } = verified.value;
  const stale = checkFreshness(m, input.nowSec);
  if (stale.length > 0) return deny(stale);

  // 2. The agreement must exist at PayPal right now.
  if (input.token === null || input.token.id !== m.agr) {
    return deny([{ code: "AGREEMENT_NOT_ACTIVE", message: "Your agreement isn't active (it may have been cancelled)." }]);
  }
  const termsText = input.token.payment_source.paypal.description;
  const parsed = termsText === undefined ? null : parseTerms(termsText);
  if (!parsed || !parsed.ok) return deny([{ code: "TERMS_UNREADABLE", message: "The approved terms on PayPal can't be read." }]);

  // 3–4. Signed by the approved key, for these terms, inside every limit.
  const termsHash = await sha256Hex(termsText!);
  const failures = checkAgainstTerms(m, fingerprint, { tokenId: input.token.id, terms: parsed.value, termsHash, merchant: input.merchant });
  if (failures.length > 0) return deny(failures);

  // 5–6. Canonical labels and the order body. invoice_id makes PayPal refuse a second charge
  // in the same period; the request IDs make a retried submission a no-op.
  const inv = invoiceId(m.agr, m.p);
  const cid = customId(m.agr, termsHash, m.p, mandateHash);
  return {
    allow: true,
    mandate: m,
    terms: parsed.value,
    mandateHash,
    invoiceId: inv,
    customId: cid,
    requestIds: requestIds(mandateHash),
    orderRequest: {
      intent: "CAPTURE",
      payment_source: {
        paypal: {
          vault_id: m.agr,
          stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "UNSCHEDULED_PREPAID" },
        },
      },
      purchase_units: [
        {
          description: termsText!,
          invoice_id: inv,
          custom_id: cid,
          amount: { currency_code: "USD", value: m.amt, breakdown: { item_total: { currency_code: "USD", value: m.amt } } },
          items: [
            {
              name: input.itemName,
              sku: m.sku,
              quantity: String(m.qty),
              unit_amount: { currency_code: "USD", value: m.unit },
              description: input.jws,
              category: "PHYSICAL_GOODS",
            },
          ],
        },
      ],
    },
  };
}

// PayPal's own refusals, mapped to the same plain-language denials (CLAUDE.md §5).
export function denialFromPayPalIssue(issue: string): Failure {
  switch (issue) {
    case "DUPLICATE_INVOICE_ID":
      return { code: "ALREADY_ORDERED_THIS_PERIOD", message: "Already ordered this period (refused by PayPal)." };
    case "INVALID_VAULT_ID":
    case "AGREEMENT_ALREADY_CANCELLED":
      return { code: "AGREEMENT_NOT_ACTIVE", message: "Your agreement isn't active (refused by PayPal)." };
    default:
      return { code: "PAYPAL_REFUSED", message: `PayPal refused the charge (${issue}).` };
  }
}
