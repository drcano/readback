// pnpm twist:charge [tokenId] — the hero's twist, sandbox only. The store charges Maya's wallet
// itself, with no request from her agent, so "Check this charge" shows the red Agent light against
// the merchant running Readback. It's the same unsigned order as judge mode's "Be a dishonest
// merchant" (apps/web/lib/demo.ts), with invoice RB-<tokenId>-DIRECT, so PayPal allows exactly one
// per agreement. Never file a claim on the hero agreement: an unauthorized claim makes PayPal delete
// it (spike step 7).
import { formatCents, PaymentTokenSchema, parseTerms } from "@readback/core";
import { CATALOG } from "@readback/core/catalog";
import { paypal } from "./spike/paypal.ts";

const SANDBOX = "https://api-m.sandbox.paypal.com";
if ((process.env["PAYPAL_API_BASE"] ?? SANDBOX) !== SANDBOX) throw new Error("twist:charge runs against the PayPal sandbox only.");
const tokenId = process.argv[2] ?? process.env["HERO_AGREEMENT_ID"];
if (!tokenId) throw new Error("Usage: pnpm twist:charge <tokenId>  (or set HERO_AGREEMENT_ID in .env)");

const token = PaymentTokenSchema.parse(await paypal({ method: "GET", path: `/v3/vault/payment-tokens/${encodeURIComponent(tokenId)}` }));
const termsText = token.payment_source.paypal.description ?? "";
const terms = parseTerms(termsText);
if (!terms.ok) throw new Error(`The agreement's terms don't parse: ${terms.error.message}`);

// Every term respected (an in-terms amount and the approved item); only the agent's request is missing.
const value = formatCents(Math.min(5900, terms.value.capCents));
const order = (await paypal({
  method: "POST",
  path: "/v2/checkout/orders",
  requestId: `rb-direct-${tokenId}`,
  body: {
    intent: "CAPTURE",
    payment_source: { paypal: { vault_id: tokenId } }, // no stored_credential, on purpose
    purchase_units: [{
      description: termsText,
      invoice_id: `RB-${tokenId}-DIRECT`,
      amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value } } },
      items: [{ name: CATALOG[terms.value.sku]?.name ?? terms.value.sku, sku: terms.value.sku, quantity: "1", unit_amount: { currency_code: "USD", value }, category: "PHYSICAL_GOODS" }],
    }],
  },
})) as { id: string; status: string; purchase_units?: { payments?: { captures?: { id: string }[] } }[] };
const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id;
console.log(`order ${order.id} ${order.status}; twist capture ${captureId ?? "missing"} (unsigned, invoice RB-${tokenId}-DIRECT)`);
if (captureId) console.log(`Set TWIST_CASE_ID=${captureId} (in .env and on Render) for the home page's pair.`);
