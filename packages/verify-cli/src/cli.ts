#!/usr/bin/env node
// npx @readbackhq/verify <disputeId|captureId>
// Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET for the merchant's account (sandbox by default;
// set PAYPAL_API_BASE to change). Prints the eleven checks and the classification. Writes nothing.
import { paypalClient } from "./paypal-client.ts";
import { report, verifyCase } from "./verify.ts";

const id = process.argv[2];
if (!id || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
  console.error("Usage: readback-verify <disputeId|captureId>");
  process.exit(2);
}
const r = await verifyCase(id, paypalClient(), new Date());
if (!r.ok) {
  console.error(r.message);
  process.exit(1);
}
console.log(report(id, r.result));
