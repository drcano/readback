// Spike step 3 (GO/NO-GO), SPEC §8: charge the saved wallet with no buyer present, and check
// that PayPal itself attests which agreement paid (payment_source.paypal.attributes.vault.id).
// Run: pnpm spike:vault-charge <tokenId> [--period=N]
//   --period  override the period index (default: computed from the terms, SPEC §4.2)
import { parseArgs } from "node:util";
import { check, getToken, info, parseTerms, periodIndex, usage, vaultOrder, type Order } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { paypal } from "./paypal.ts";

const { positionals, values } = parseArgs({
  options: { period: { type: "string" } },
  allowPositionals: true,
  strict: true,
});
const tokenId = positionals[0];
if (!tokenId || !/^[0-9A-Za-z_-]{1,36}$/.test(tokenId)) usage("pnpm spike:vault-charge <tokenId> [--period=N]");

const token = await getToken(tokenId);
saveFixture("03-payment-token", token);
const terms = parseTerms(token.payment_source.paypal?.description ?? "");
const period = values.period ? Number(values.period) : periodIndex(terms.start, terms.periodDays);
const { body, charge } = await vaultOrder(token, period);

console.log(`terms: ${charge.terms}`);
console.log(`period p=${period}  invoice_id ${charge.invoiceId}  custom_id ${charge.customId}`);
saveFixture("03-order-request", body); // exactly what we sent; no PII in it

// Deterministic per agreement + period. Re-running this script replays the original order
// (PayPal idempotency) instead of creating a second charge. Pass --period to force a new one.
const requestId = `rb-spike03-create-${tokenId}-P${String(period).padStart(3, "0")}`;
console.log(`PayPal-Request-Id: ${requestId} (re-running returns the same order)\n`);
const created = (await paypal({ method: "POST", path: "/v2/checkout/orders", requestId, body })) as Order;
saveFixture("03-order-created", created);
info(`order ${created.id} status on create: ${created.status}`);
info(`auto-completed on create: ${created.status === "COMPLETED" ? "YES (no capture call needed)" : "NO"}`);

if (created.status === "PAYER_ACTION_REQUIRED") {
  check("no buyer action required (autonomous mode viable)", false);
} else if (created.status !== "COMPLETED") {
  // Not auto-completed: capture explicitly, as the gate would (SPEC §5.3 step 6).
  const captured = (await paypal({
    method: "POST",
    path: `/v2/checkout/orders/${created.id}/capture`,
    requestId: `rb-spike03-capture-${created.id}`,
    body: {},
  })) as Order;
  saveFixture("03-order-captured", captured);
  info(`after explicit capture: ${captured.status}`);
}

const order = (await paypal({ method: "GET", path: `/v2/checkout/orders/${created.id}` })) as Order;
saveFixture("03-order-get", order);
const pu = order.purchase_units[0];
const vault = order.payment_source?.paypal?.attributes?.vault;

console.log(`\n=== GO/NO-GO ===`);
check(`GET order echoes attributes.vault.id === tokenId (got ${vault?.id ?? "nothing"})`, vault?.id === tokenId);
info(`attributes.vault.status: ${vault?.status}`);
info(`stored_credential echoed on GET: ${order.payment_source?.paypal?.stored_credential ? "yes" : "no"}`);
console.log("");
check("order payer_id === token payer_id (SPEC §5.6 check 1)", order.payer?.payer_id === token.payment_source.paypal?.payer_id);
check("purchase_units[0].description === token description", pu?.description === charge.terms);
check("custom_id round-trips", pu?.custom_id === charge.customId);
check("invoice_id round-trips", pu?.invoice_id === charge.invoiceId);
check("items[0].description (JWS) round-trips", pu?.items?.[0]?.description === charge.jws);

const cap = pu?.payments?.captures?.[0];
check(`capture exists and COMPLETED (got ${cap?.status})`, cap?.status === "COMPLETED");
if (cap) {
  type Capture = { custom_id?: string; invoice_id?: string; seller_protection?: unknown; supplementary_data?: { related_ids?: { order_id?: string } } };
  const c = (await paypal({ method: "GET", path: `/v2/payments/captures/${cap.id}` })) as Capture;
  saveFixture("03-capture", c);
  check("capture -> order_id (SPEC §5.5 dispute path)", c.supplementary_data?.related_ids?.order_id === order.id);
  check("capture.custom_id", c.custom_id === charge.customId);
  console.log("seller_protection:", JSON.stringify(c.seller_protection));
  console.log(`\nORDER ID (for step 8):   ${order.id}\nCAPTURE ID:              ${cap.id}`);
}
