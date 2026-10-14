// Spike step 4, SPEC §8: PayPal's duplicate-invoice block is Readback's "one order per period"
// guard (SPEC §4.4, §5.6 check 7). Three questions:
//   A. Does a second charge with the same invoice_id fail DUPLICATE_INVOICE_ID?
//   B. Does a declined attempt use up an invoice_id?
//   C. Does re-sending the same PayPal-Request-Id return the original order?
// Run AFTER step 3 (A needs step 3's completed charge in the current period).
// Run: pnpm spike:duplicate-guard <tokenId> [--period=N] [--scratch=901]
//   --period   the period step 3 charged (default: computed from the terms)
//   --scratch  unused period index for B and C (default 901; bump it if you re-run)
import { parseArgs } from "node:util";
import { check, getToken, info, parseTerms, periodIndex, usage, vaultOrder, type Order } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { issues, paypalRaw, type PayPalResponse } from "./paypal.ts";

const { positionals, values } = parseArgs({
  options: { period: { type: "string" }, scratch: { type: "string", default: "901" } },
  allowPositionals: true,
  strict: true,
});
const tokenId = positionals[0];
if (!tokenId || !/^[0-9A-Za-z_-]{1,36}$/.test(tokenId)) {
  usage("pnpm spike:duplicate-guard <tokenId> [--period=N] [--scratch=901]");
}

const token = await getToken(tokenId);
const terms = parseTerms(token.payment_source.paypal?.description ?? "");
const period = values.period ? Number(values.period) : periodIndex(terms.start, terms.periodDays);
const scratch = Number(values.scratch);
const nnn = (p: number) => String(p).padStart(3, "0");

function show(label: string, r: PayPalResponse): void {
  // Print the whole ERROR body (exact name/details/debug_id go into the ADR). A success body is
  // a full order with payer PII, so for those print only id + status (the fixture is scrubbed).
  const o = r.json as Order;
  const detail = r.ok ? `order ${o.id} ${o.status}` : JSON.stringify(r.json, null, 2);
  console.log(`${label}: HTTP ${r.status}, debug_id ${r.debugId}\n${detail}\n`);
}

// ---------- A. same invoice_id as step 3 ----------
console.log(`\n=== A. Second charge in period P${nnn(period)} (step 3 already charged it) ===`);
const dup = await vaultOrder(token, period);
// New request ID on purpose: reusing step 3's would replay step 3's order (that's test C).
const a = await paypalRaw({
  method: "POST",
  path: "/v2/checkout/orders",
  requestId: `rb-spike04-dup-${tokenId}-P${nnn(period)}`,
  body: dup.body,
});
saveFixture("04-duplicate-response", a.json);
show("duplicate attempt", a);
if (a.ok && (a.json as Order).status !== "COMPLETED") {
  // If PayPal only checks invoice_id at capture time, the error shows up here instead.
  const id = (a.json as Order).id;
  const cap = await paypalRaw({ method: "POST", path: `/v2/checkout/orders/${id}/capture`, requestId: `rb-spike04-dup-capture-${id}`, body: {} });
  saveFixture("04-duplicate-capture-response", cap.json);
  show("duplicate capture", cap);
  check("DUPLICATE_INVOICE_ID at capture", issues(cap.json).includes("DUPLICATE_INVOICE_ID"));
} else {
  check(`second charge refused with DUPLICATE_INVOICE_ID (issues: ${issues(a.json).join(", ") || "none"})`, issues(a.json).includes("DUPLICATE_INVOICE_ID"));
}
info("If this charged instead, 'block accidental payments' is OFF: sandbox.paypal.com as the MERCHANT > Account Settings > Payment preferences.");

// ---------- B. does a declined attempt consume the invoice_id? ----------
console.log(`\n=== B. Declined attempt, then a clean retry, both P${nnn(scratch)} ===`);
// Sandbox negative testing: PayPal-Mock-Response makes PayPal answer with a canned error.
// Honest limit: a mocked decline may never reach PayPal's invoice store, so a clean retry
// succeeding proves "mocked declines don't consume IDs", not "real issuer declines don't".
// A real funding decline on a PayPal-wallet vault charge can't be forced on demand in sandbox.
const declined = await vaultOrder(token, scratch);
const b1 = await paypalRaw({
  method: "POST",
  path: "/v2/checkout/orders",
  requestId: `rb-spike04-mockdecline-${tokenId}-P${nnn(scratch)}`,
  body: declined.body,
  headers: { "PayPal-Mock-Response": JSON.stringify({ mock_application_codes: "INSTRUMENT_DECLINED" }) },
});
saveFixture("04-mock-decline-response", b1.json);
show("mocked decline", b1);
const mockHonored = !b1.ok && issues(b1.json).includes("INSTRUMENT_DECLINED");
info(`mock decline honored on a vault MIT order: ${mockHonored ? "yes" : "NO"}`);

const retry = await vaultOrder(token, scratch);
const retryRequestId = `rb-spike04-retry-${tokenId}-P${nnn(scratch)}`;
const b2 = await paypalRaw({ method: "POST", path: "/v2/checkout/orders", requestId: retryRequestId, body: retry.body });
saveFixture("04-retry-after-decline", b2.json);
if (b2.ok) {
  console.log(`clean retry: order ${(b2.json as Order).id} ${(b2.json as Order).status}`);
} else {
  show("clean retry", b2);
}
if (mockHonored) {
  check("clean retry after a (mocked) decline is NOT refused as duplicate", b2.ok);
} else {
  info("B not testable this way: the mock was ignored, so the 'decline' was a real charge.");
}

// ---------- C. same PayPal-Request-Id returns the original order ----------
console.log(`\n=== C. Re-send the clean retry with its PayPal-Request-Id (${retryRequestId}) ===`);
if (b2.ok) {
  const c = await paypalRaw({ method: "POST", path: "/v2/checkout/orders", requestId: retryRequestId, body: retry.body });
  saveFixture("04-idempotent-replay", c.json);
  const first = b2.json as Order;
  const again = c.json as Order;
  if (!c.ok) show("replay", c);
  check(`replay returns the original order (${first.id} vs ${again.id ?? "none"})`, c.ok && again.id === first.id);
  check("replay is not a duplicate-invoice error", !issues(c.json).includes("DUPLICATE_INVOICE_ID"));
} else {
  info("C skipped: the clean retry didn't create an order to replay.");
}
console.log(`\nNext run: pass --scratch=${scratch + 1} (P${nnn(scratch)} is now used).`);
