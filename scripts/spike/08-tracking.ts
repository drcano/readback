// Spike step 8, SPEC §8: add a shipment tracker to an order and read it back from GET order
// (SPEC §5.3 step 7, §5.6 check 10).
// Run: pnpm spike:tracking <orderId>     (the ORDER ID printed by step 3)
import { parseArgs } from "node:util";
import { check, info, TRACKING, usage, type Order } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { paypal } from "./paypal.ts";

const { positionals } = parseArgs({ allowPositionals: true, strict: true });
const orderId = positionals[0];
if (!orderId || !/^[0-9A-Z]{10,36}$/.test(orderId)) usage("pnpm spike:tracking <orderId>");

const before = (await paypal({ method: "GET", path: `/v2/checkout/orders/${orderId}` })) as Order;
const pu = before.purchase_units[0];
const captureId = pu?.payments?.captures?.[0]?.id;
if (!captureId) usage(`order ${orderId} has no capture to track (status ${before.status})`);
const item = pu?.items?.[0];

// Request shape from checkout_orders_v2.json#/components/schemas/order_tracker_request:
// capture_id, tracking_number and carrier are required; items and notify_payer optional.
const tracker = {
  capture_id: captureId,
  tracking_number: TRACKING.number,
  carrier: TRACKING.carrier,
  notify_payer: true, // SPEC §5.3 step 7. Sandbox emails land in the developer dashboard's Notifications.
  items: item ? [{ name: item.name, sku: item.sku, quantity: item.quantity }] : [],
};
const tracked = await paypal({
  method: "POST",
  path: `/v2/checkout/orders/${orderId}/track`,
  requestId: `rb-spike08-track-${orderId}`,
  body: tracker,
});
saveFixture("08-track-response", tracked);

const after = (await paypal({ method: "GET", path: `/v2/checkout/orders/${orderId}` })) as Order;
saveFixture("08-order-get", after);
const trackers = after.purchase_units[0]?.shipping?.trackers ?? [];
const t = trackers[0];
console.log("trackers:", JSON.stringify(trackers, null, 2));
check(`GET order has purchase_units[0].shipping.trackers[] (${trackers.length})`, trackers.length > 0);
check(`tracker status SHIPPED (got ${t?.status})`, t?.status === "SHIPPED");
check("tracker items[0].sku matches the order item", t?.items?.[0]?.sku === item?.sku);
// The tracker schema has no tracking_number field; PayPal's tracker id usually embeds it.
info(`tracker id ${t?.id}: ${t?.id?.includes(TRACKING.number) ? "embeds" : "does NOT embed"} the tracking number`);
