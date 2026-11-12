// "Be a dishonest merchant" (SPEC §5.7, THREAT-MODEL T32). Demo-only and fenced: it charges a
// judge's OWN demo agreement through the merchant's credentials with no mandate, no custom_id and
// a non-canonical invoice, so the case view can show the red Agent light on the judge's own key.
import { formatCents, parseTerms, PaymentTokenSchema, type Failure, verifyActionProof } from "@readbackhq/core";
import { z } from "zod";
import { CATALOG } from "./catalog";
import type { PayPalClient } from "./paypal/client";

const SANDBOX = "https://api-m.sandbox.paypal.com";

// The route refuses to run unless DEMO_MODE=true AND PayPal is the sandbox. Checked per request.
export function demoEnabled(env: Record<string, string | undefined>): boolean {
  return env["DEMO_MODE"] === "true" && (env["PAYPAL_API_BASE"] ?? SANDBOX) === SANDBOX;
}

const Order = z.object({
  id: z.string(),
  purchase_units: z.array(z.object({ payments: z.object({ captures: z.array(z.object({ id: z.string() })).optional() }).optional() })).optional(),
});

export async function directCharge(
  paypal: PayPalClient,
  input: { tokenId: string; proof: string },
  now: Date,
): Promise<{ ok: true; captureId: string } | { ok: false; status: number; failure: Failure }> {
  const tok = await paypal.get(`/v3/vault/payment-tokens/${encodeURIComponent(input.tokenId)}`, PaymentTokenSchema);
  if (!tok.ok) return tok.status === 404
    ? { ok: false, status: 404, failure: { code: "AGREEMENT_NOT_ACTIVE", message: "That agreement isn't active." } }
    : { ok: false, status: 502, failure: { code: "PAYPAL_UNAVAILABLE", message: "PayPal couldn't be reached; nothing was charged. Try again." } };
  const terms = parseTerms(tok.data.payment_source.paypal.description ?? "");
  if (!terms.ok) return { ok: false, status: 422, failure: terms.error };

  // Ownership: the judge's tab key signed this, and judge agreements always start today.
  const proof = await verifyActionProof(input.proof, {
    tokenId: input.tokenId,
    purpose: "direct-charge",
    termsFingerprint: terms.value.fingerprint,
    nowSec: Math.floor(now.getTime() / 1000),
  });
  if (!proof.ok) return { ok: false, status: 403, failure: proof.error };
  // Today or yesterday (UTC), so a judge who approved just before midnight isn't locked out; the hero
  // agreement (started Oct 15) and other seeded agreements stay out of reach.
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (terms.value.start !== now.toISOString().slice(0, 10) && terms.value.start !== yesterday) {
    return { ok: false, status: 403, failure: { code: "NOT_A_JUDGE_AGREEMENT", message: "Only demo agreements approved today or yesterday can be charged directly." } };
  }

  // Every term respected (in-terms amount and item); only the agent's request is missing.
  const cents = Math.min(5900, terms.value.capCents);
  const value = formatCents(cents);
  const name = CATALOG[terms.value.sku]?.name ?? terms.value.sku;
  const res = await paypal.post(
    "/v2/checkout/orders",
    `rb-direct-${input.tokenId}`,
    {
      intent: "CAPTURE",
      payment_source: { paypal: { vault_id: input.tokenId } }, // no stored_credential, on purpose
      purchase_units: [
        {
          description: tok.data.payment_source.paypal.description,
          invoice_id: `RB-${input.tokenId}-DIRECT`, // PayPal's duplicate block allows one per agreement
          amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value } } },
          items: [{ name, sku: terms.value.sku, quantity: "1", unit_amount: { currency_code: "USD", value }, category: "PHYSICAL_GOODS" }],
        },
      ],
    },
    Order,
  );
  if (!res.ok) {
    const dup = res.issues.includes("DUPLICATE_INVOICE_ID");
    return { ok: false, status: 409, failure: dup ? { code: "ALREADY_DONE", message: "This agreement already has its one dishonest charge." } : { code: "PAYPAL_REFUSED", message: res.issues.join(", ") } };
  }
  const captureId = res.data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  return captureId ? { ok: true, captureId } : { ok: false, status: 502, failure: { code: "CAPTURE_NOT_COMPLETED", message: "PayPal didn't complete the charge." } };
}
