// Readback's quick-start: add agent-purchase evidence to a PayPal integration you already have.
// Run: pnpm --filter existing-paypal-merchant start
// It runs offline: an in-memory PayPal stands in for the sandbox (the same fake Readback's tests use).
import { authorizeCharge, buildMandate, evaluateCase, formatTerms, generateAgentKey, sha256Hex, signMandate, type Terms } from "@readback/core";
import { buildCaseBundle, paypalClient } from "@readback/verify";
import { fakePayPal } from "@readback/verify/fake";

// ── Setup: things you already have, or that happen on the shopper's side ────────────────────
const paypal = fakePayPal();
const PAYPAL = "https://api-m.sandbox.paypal.com";
const MERCHANT = "Good Boy Provisions";
const today = new Date().toISOString().slice(0, 10);

// The shopper's agent has a key; she approved terms naming its fingerprint on PayPal. PayPal keeps
// them in her vaulted payment token's description (in real life: setup token → approval → token).
const agent = await generateAgentKey(true);
const terms: Terms = { merchant: MERCHANT, sku: "GBP-SR24", qty: 1, periodDays: 30, capCents: 6500, start: today, end: "2027-12-31", fingerprint: agent.fingerprint };
const tokenId = "8kd73hs9ab";
paypal.tokens.set(tokenId, { id: tokenId, payment_source: { paypal: { description: formatTerms(terms), payer_id: "FAKEPAYER0001" } } });

// Her agent signs one closed mandate for this order and sends it to your checkout.
const now = Math.floor(Date.now() / 1000);
const mandate = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId, terms, termsHash: await sha256Hex(formatTerms(terms)) }, now, "quickstart-0001");
if (!mandate.ok) throw new Error(mandate.error.message);
const jws = await signMandate(mandate.value, agent.privateKey, agent.publicJwk);

// Your existing PayPal calls (shown with fetch; use whatever client you already have).
const auth = { Authorization: "Bearer <your access token>", "Content-Type": "application/json" };
const getToken = async (id: string) => (await paypal.fetch(`${PAYPAL}/v3/vault/payment-tokens/${id}`, { headers: auth })).json();

// ── The 10 lines ─────────────────────────────────────────────────────────────────────────────
const decision = await authorizeCharge({ jws, token: await getToken(tokenId), merchant: MERCHANT, itemName: "Salmon & Rice Adult (24 lb)", nowSec: now });
if (!decision.allow) throw new Error(decision.failures.map((f) => f.message).join("; ")); // fail closed
const res = await paypal.fetch(`${PAYPAL}/v2/checkout/orders`, {
  method: "POST",
  headers: { ...auth, "PayPal-Request-Id": decision.requestIds.create }, // retries are no-ops
  body: JSON.stringify(decision.orderRequest), // vault_id, signed mandate, terms copy, invoice_id, custom_id
});
const order = (await res.json()) as { id: string; status: string; purchase_units: { payments: { captures: { id: string }[] } }[] };
console.log(`Charged: order ${order.id} ${order.status}, invoice ${decision.invoiceId}`);
// ── That's the integration. Everything Readback needs later now lives in PayPal. ─────────────

// Later, the shopper says "my AI bought that". Rebuild the case from PayPal alone and check it.
const disputeId = paypal.openDispute(order.purchase_units[0]!.payments.captures[0]!.id, "UNAUTHORISED");
const lookup = await buildCaseBundle(disputeId, paypalClient({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }, paypal.fetch), new Date());
if (!lookup.ok) throw new Error(lookup.message);
const result = await evaluateCase(lookup.bundle);
console.log(`Dispute ${disputeId}: ${result.classification.label} → ${result.classification.suggestion ?? "no suggestion"}`);
