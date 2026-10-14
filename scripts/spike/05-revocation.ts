// Spike step 5, SPEC §8: what does revocation look like from PayPal's side?
//   merchant-side: DELETE the token, then try to charge it and GET it.
//   buyer-side:    --buyer-cancel: the script pauses while Maya cancels in her PayPal settings.
// DESTRUCTIVE: use a second agreement (step 2 run again), not the one steps 3/4/7/8 use.
// Before running: register a webhook for VAULT.PAYMENT-TOKEN.DELETED on the sandbox app
// (developer.paypal.com > Apps & Credentials > your app > Webhooks), or the event list is empty
// whatever PayPal does. Any https URL works (e.g. https://example.com/webhook).
// Run: pnpm spike:revocation <tokenId> [--buyer-cancel] [--period=950]
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { check, getToken, info, pause, usage, vaultOrder } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { issues, paypal, paypalRaw } from "./paypal.ts";

const { positionals, values } = parseArgs({
  options: { "buyer-cancel": { type: "boolean", default: false }, period: { type: "string", default: "950" } },
  allowPositionals: true,
  strict: true,
});
const tokenId = positionals[0];
if (!tokenId || !/^[0-9A-Za-z_-]{1,36}$/.test(tokenId)) {
  usage("pnpm spike:revocation <tokenId> [--buyer-cancel] [--period=950]");
}
const mode = values["buyer-cancel"] ? "buyer" : "merchant";
const startTime = new Date(Date.now() - 60_000).toISOString(); // event search window starts here

// Read the token while it still exists: the charge attempt below needs its terms.
const token = await getToken(tokenId);
saveFixture(`05-${mode}-token-before`, token);

if (mode === "merchant") {
  const answer = await pause(`About to DELETE payment token ${tokenId}. Type DELETE to continue: `);
  if (answer.trim() !== "DELETE") {
    console.log("Aborted; nothing deleted.");
    process.exit(1);
  }
  const del = await paypalRaw({ method: "DELETE", path: `/v3/vault/payment-tokens/${tokenId}` });
  check(`DELETE token -> 204 (got ${del.status})`, del.status === 204);
} else {
  console.log(`
Log in to https://www.sandbox.paypal.com as MAYA (sandbox PERSONAL account)
  > Settings (gear) > Payments > Manage automatic payments
  > select "Good Boy Provisions" > Cancel. Screenshot each screen.
(If the menu names differ, record what you see: that's a spike finding.)`);
  await pause("Press Enter once cancelled...");
}

// A fresh period, so DUPLICATE_INVOICE_ID can't mask the revocation error we want to see.
const period = Number(values.period);
const { body } = await vaultOrder(token, period);
const charge = await paypalRaw({
  method: "POST",
  path: "/v2/checkout/orders",
  requestId: `rb-spike05-${mode}-charge-${tokenId}-P${period}`,
  body,
});
saveFixture(`05-${mode}-charge-after-revoke`, charge.json);
// Error body in full; a success (token still live!) would be an order with payer PII, so id only.
const chargeDetail = charge.ok ? `order ${(charge.json as { id?: string }).id} CHARGED` : JSON.stringify(charge.json, null, 2);
console.log(`charge attempt: HTTP ${charge.status}, debug_id ${charge.debugId}\n${chargeDetail}`);
const got = issues(charge.json);
check(`charge refused (issues: ${got.join(", ") || "none"})`, !charge.ok);
info(`INVALID_VAULT_ID: ${got.includes("INVALID_VAULT_ID")}, AGREEMENT_ALREADY_CANCELLED: ${got.includes("AGREEMENT_ALREADY_CANCELLED")}`);

const after = await paypalRaw({ method: "GET", path: `/v3/vault/payment-tokens/${tokenId}` });
saveFixture(`05-${mode}-token-after`, after.json);
check(`GET token after revoke -> 404 (got ${after.status})`, after.status === 404);
if (after.ok) console.log("token still readable; description:", (after.json as typeof token).payment_source.paypal?.description);

// ---------- Webhooks: is the deletion event retrievable later? ----------
type Webhooks = { webhooks?: { id: string; url: string; event_types: { name: string }[] }[] };
const hooks = (await paypal({ method: "GET", path: "/v1/notifications/webhooks" })) as Webhooks;
const subscribed = (hooks.webhooks ?? []).some((w) =>
  w.event_types.some((e) => e.name === "VAULT.PAYMENT-TOKEN.DELETED" || e.name === "*"),
);
check("a webhook on this app subscribes to VAULT.PAYMENT-TOKEN.DELETED (else events can't be listed)", subscribed);

const catalog = (await paypal({ method: "GET", path: "/v1/notifications/webhooks-event-types" })) as { event_types?: { name: string }[] };
info(`VAULT.PAYMENT-TOKEN.DELETED in PayPal's event catalog: ${(catalog.event_types ?? []).some((e) => e.name === "VAULT.PAYMENT-TOKEN.DELETED")}`);

type Events = { events?: { id: string; event_type: string; create_time: string; resource?: { id?: string } }[] };
let match: NonNullable<Events["events"]>[number] | undefined;
// Events can take a few seconds to appear, so poll briefly (3 tries, 10 s apart).
for (let attempt = 1; attempt <= 3 && !match; attempt++) {
  if (attempt > 1) await sleep(10_000);
  const q = new URLSearchParams({ event_type: "VAULT.PAYMENT-TOKEN.DELETED", start_time: startTime, page_size: "50" });
  const events = (await paypal({ method: "GET", path: `/v1/notifications/webhooks-events?${q}` })) as Events;
  saveFixture(`05-${mode}-webhook-events`, events);
  match = events.events?.find((e) => e.resource?.id === tokenId);
}
check("VAULT.PAYMENT-TOKEN.DELETED for this token is listed by webhooks-events", match !== undefined);
if (match) info(`event ${match.id} at ${match.create_time} (SPEC §5.6 check 4 can use this time)`);

if (mode === "merchant") {
  console.log(`
Buyer-side test: run step 2 again for ANOTHER fresh agreement (approve as MAYA), then:
  pnpm spike:revocation <newTokenId> --buyer-cancel
`);
}
