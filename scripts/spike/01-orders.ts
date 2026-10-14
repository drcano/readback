// Spike step 1 (must pass), SPEC §8: create + capture an order carrying every Readback field,
// and confirm each one comes back byte-for-byte on GET.
// Run: pnpm spike:orders   (needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env)
import { createInterface } from "node:readline/promises";
import { saveFixture } from "./fixtures.ts";
import { buildCharge } from "./mandate.ts";
import { paypal } from "./paypal.ts";

// Only the fields we read back. Spike only; product code parses PayPal responses with zod.
type Money = { currency_code: string; value: string };
type Order = {
  id: string;
  status: string;
  links: { rel: string; href: string }[];
  purchase_units: {
    description?: string;
    custom_id?: string;
    invoice_id?: string;
    amount?: Money & { breakdown?: { item_total?: Money } };
    items?: { name: string; sku?: string; quantity: string; unit_amount: Money; description?: string }[];
    payments?: { captures?: { id: string; status: string; custom_id?: string; invoice_id?: string }[] };
  }[];
};
type Capture = {
  id: string;
  status: string;
  custom_id?: string;
  invoice_id?: string;
  seller_protection?: unknown;
  supplementary_data?: { related_ids?: { order_id?: string } };
};

// One run = one fake agreement. A fresh tokenId per run keeps invoice_id unique, so PayPal's
// duplicate-invoice block doesn't refuse a second run (step 4 tests that block on purpose).
// 36 chars = the longest tokenId SPEC §4.4 allows, so custom_id is at its worst-case length.
const run = Date.now().toString(36).toUpperCase();
const tokenId = `SPIKE01${run}`.padEnd(36, "X");
const charge = await buildCharge({ tokenId, sku: "GBP-SR24", qty: 1, unit: "64.99", period: 1 });

console.log(`terms (${charge.terms.length} chars):    ${charge.terms}`);
console.log(`custom_id (${charge.customId.length} chars): ${charge.customId}`);
console.log(`invoice_id: ${charge.invoiceId}`);
console.log(`mandate JWS: ${charge.jws.length} chars\n`);

const sent = {
  description: charge.terms,
  custom_id: charge.customId,
  invoice_id: charge.invoiceId,
  amount: {
    currency_code: "USD",
    value: charge.amt,
    breakdown: { item_total: { currency_code: "USD", value: charge.amt } },
  },
  items: [
    {
      name: "Salmon & Rice Adult (24 lb)",
      sku: "GBP-SR24",
      quantity: "1",
      unit_amount: { currency_code: "USD", value: "64.99" },
      description: charge.jws,
    },
  ],
};

const created = (await paypal({
  method: "POST",
  path: "/v2/checkout/orders",
  requestId: `rb-spike01-create-${run}`,
  body: { intent: "CAPTURE", purchase_units: [sent] },
})) as Order;
saveFixture("01-order-created", created);

const fetched = (await paypal({ method: "GET", path: `/v2/checkout/orders/${created.id}` })) as Order;
saveFixture("01-order-get-before-capture", fetched);
checkRoundTrip("GET after create", fetched);

const approve = created.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
console.log(`\nLog in as MAYA's sandbox personal account and approve:\n  ${approve}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter once approved...");
rl.close();

const captured = (await paypal({
  method: "POST",
  path: `/v2/checkout/orders/${created.id}/capture`,
  requestId: `rb-spike01-capture-${run}`,
  body: {},
})) as Order;
saveFixture("01-order-captured", captured);

const after = (await paypal({ method: "GET", path: `/v2/checkout/orders/${created.id}` })) as Order;
saveFixture("01-order-get-after-capture", after);
checkRoundTrip("GET after capture", after);

const captureId = after.purchase_units[0]?.payments?.captures?.[0]?.id;
if (captureId) {
  // The dispute path goes capture -> order (SPEC §5.5), so check the capture links back.
  const cap = (await paypal({ method: "GET", path: `/v2/payments/captures/${captureId}` })) as Capture;
  saveFixture("01-capture", cap);
  console.log(`\ncapture ${cap.id} ${cap.status}`);
  check("capture.custom_id", cap.custom_id === charge.customId);
  check("capture.invoice_id", cap.invoice_id === charge.invoiceId);
  check("capture -> order_id", cap.supplementary_data?.related_ids?.order_id === created.id);
  console.log("seller_protection:", JSON.stringify(cap.seller_protection));
} else {
  check("capture exists", false);
}

console.log(`\nNow open Maya's sandbox account (sandbox.paypal.com) > Activity > this $${charge.amt} payment,`);
console.log("and note what the receipt shows for the item description and invoice ID.");

function checkRoundTrip(label: string, order: Order): void {
  console.log(`\n${label}: order ${order.id} ${order.status}`);
  const pu = order.purchase_units[0];
  const item = pu?.items?.[0];
  check("purchase_units[0].description (terms)", pu?.description === sent.description);
  check("custom_id", pu?.custom_id === sent.custom_id);
  check("invoice_id", pu?.invoice_id === sent.invoice_id);
  check("amount.value", pu?.amount?.value === sent.amount.value);
  check("breakdown.item_total", pu?.amount?.breakdown?.item_total?.value === sent.amount.value);
  check("items[0].name", item?.name === sent.items[0]!.name);
  check("items[0].sku", item?.sku === sent.items[0]!.sku);
  check("items[0].quantity", item?.quantity === sent.items[0]!.quantity);
  check("items[0].unit_amount", item?.unit_amount.value === sent.items[0]!.unit_amount.value);
  check(
    `items[0].description (signed mandate): sent ${charge.jws.length}, got ${item?.description?.length ?? 0} chars`,
    item?.description === charge.jws,
  );
}

function check(label: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}
