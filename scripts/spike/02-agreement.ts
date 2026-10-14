// Spike step 2, SPEC §8: create a Vault v3 agreement (setup token -> buyer approval -> payment
// token) carrying the terms string, and confirm PayPal stores it byte-for-byte.
// Run: pnpm spike:agreement [--recurring] [--compare=<firstTokenId>]
//   --recurring       try usage_pattern RECURRING_PREPAID instead of UNSCHEDULED_PREPAID
//   --compare=<id>    second agreement for the same buyer: check it gets a distinct token
import { parseArgs } from "node:util";
import { exportJWK, generateKeyPair, calculateJwkThumbprint } from "jose";
import { check, getToken, info, ITEM, parseTerms, pause, usage, type PaymentToken } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { paypal } from "./paypal.ts";

// parseArgs is Node's built-in argparse. `strict` makes unknown flags an error.
const { values } = parseArgs({
  options: { recurring: { type: "boolean", default: false }, compare: { type: "string" } },
  strict: true,
});
if (values.compare !== undefined && !/^[0-9A-Za-z_-]+$/.test(values.compare)) {
  usage("pnpm spike:agreement [--recurring] [--compare=<firstTokenId>]");
}
const usagePattern = values.recurring ? "RECURRING_PREPAID" : "UNSCHEDULED_PREPAID";

type SetupToken = { id: string; status: string; links: { rel: string; href: string }[]; payment_source?: PaymentToken["payment_source"] };

// A throwaway agent key, only for the fingerprint in the terms. Step 3 signs with a different
// throwaway key (see mandate.ts): PayPal never checks the fingerprint, Readback does.
const { publicKey } = await generateKeyPair("ES256", { extractable: true });
const { kty, crv, x, y } = await exportJWK(publicKey);
const fingerprint = (await calculateJwkThumbprint({ kty, crv, x, y }, "sha256")).slice(0, 16);

const start = new Date().toISOString().slice(0, 10); // today, UTC, YYYY-MM-DD
const end = "2027-03-31";
const periodDays = 30;
const cap = "65.00";
const terms = `RB1 Good Boy Provisions | ${ITEM.sku} x1/${periodDays}d | max USD ${cap} | ${start}..${end} | agent ${fingerprint}`;
parseTerms(terms); // throws if we built it wrong
console.log(`usage_pattern: ${usagePattern}`);
console.log(`terms (${terms.length} chars, token limit 128): ${terms}\n`);

// SPEC §4.5: billing_plan is display-only. Vault v3's OpenAPI leaves `frequency` as an empty
// schema, so this uses the Subscriptions v1 shape {interval_unit, interval_count} (DAY max 365).
const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
const billingPlan = {
  name: `Good Boy Provisions: ${ITEM.sku} x1 every ${periodDays} days, max USD ${cap}`,
  billing_cycles: [
    {
      tenure_type: "REGULAR",
      pricing_scheme: { pricing_model: "VARIABLE", price: { currency_code: "USD", value: cap } },
      frequency: { interval_unit: "DAY", interval_count: periodDays },
      total_cycles: Math.ceil(days / periodDays),
      sequence: 1,
      start_date: start,
    },
  ],
  one_time_charges: { total_amount: { currency_code: "USD", value: "0.00" } },
};

// One run = one agreement attempt. The run tag keeps the request ID unique per attempt
// while staying derived (not random) — same pattern as 01-orders.ts.
const run = Date.now().toString(36).toUpperCase();
const setupRequest = {
  payment_source: {
    paypal: {
      description: terms,
      usage_pattern: usagePattern,
      usage_type: "MERCHANT",
      customer_type: "CONSUMER",
      permit_multiple_payment_tokens: true,
      billing_plan: billingPlan,
      experience_context: {
        brand_name: "Good Boy Provisions",
        return_url: "https://example.com/return",
        cancel_url: "https://example.com/cancel",
      },
    },
  },
};
saveFixture("02-setup-token-request", setupRequest);

const setup = (await paypal({
  method: "POST",
  path: "/v3/vault/setup-tokens",
  requestId: `rb-spike02-setup-${run}`,
  body: setupRequest,
})) as SetupToken;
saveFixture("02-setup-token", setup);
console.log(`setup token ${setup.id} ${setup.status}`);

const approve = setup.links.find((l) => l.rel === "approve")?.href;
console.log(`\nLog in as MAYA (sandbox PERSONAL account) and approve:\n  ${approve}`);
console.log("SCREENSHOT the approval page: does it show the terms text and the billing plan?");
console.log("After approving, PayPal redirects to example.com/return (that page 404s; that's fine).\n");
await pause("Press Enter once approved...");

const approved = (await paypal({ method: "GET", path: `/v3/vault/setup-tokens/${setup.id}` })) as SetupToken;
saveFixture("02-setup-token-approved", approved);
check(`setup token status APPROVED (got ${approved.status})`, approved.status === "APPROVED");

// Exchange the approved setup token for the long-lived payment token (the agreement).
// Request ID derives from the setup token, so a retry can't mint a second payment token.
const created = (await paypal({
  method: "POST",
  path: "/v3/vault/payment-tokens",
  requestId: `rb-spike02-token-${setup.id}`,
  body: { payment_source: { token: { id: setup.id, type: "SETUP_TOKEN" } } },
})) as PaymentToken;
saveFixture("02-payment-token-created", created);

const token = await getToken(created.id);
saveFixture("02-payment-token-get", token);
const pp = token.payment_source.paypal;

console.log(`\nPayment token: ${token.id}`);
check("description round-trips byte-equal on GET token", pp?.description === terms);
check("description also on the create response", created.payment_source.paypal?.description === terms);
check(`usage_pattern echoed (${pp?.usage_pattern})`, pp?.usage_pattern === usagePattern);
check(`permit_multiple_payment_tokens echoed (${pp?.permit_multiple_payment_tokens})`, pp?.permit_multiple_payment_tokens === true);
check("payer_id present (SPEC §5.6 check 1 needs it)", typeof pp?.payer_id === "string");
check("billing_plan absent on GET (SPEC §3 assumes display-only)", pp?.billing_plan === undefined);
info(`usage_type ${pp?.usage_type}, customer_type ${pp?.customer_type}, customer.id ${token.customer?.id ? "present" : "absent"}`);
info(`shipping address on token: ${pp?.shipping ? "present" : "absent"} (SPEC §5.6 check 10 compares it)`);
check(`token ID length ${token.id.length} <= 36`, token.id.length <= 36);
check("token ID charset ^[0-9A-Za-z_-]{1,36}$ (SPEC §4.4)", /^[0-9A-Za-z_-]{1,36}$/.test(token.id));

if (values.compare) {
  // Same buyer, second agreement: must be a separate token, or two agreements would collide.
  const first = await getToken(values.compare);
  saveFixture("02-payment-token-first", first);
  check("distinct token ID from the first agreement", first.id !== token.id);
  check("same payer_id (same buyer approved both)", first.payment_source.paypal?.payer_id === pp?.payer_id);
  const firstCustomer = first.customer?.id;
  if (firstCustomer) {
    const list = (await paypal({
      method: "GET",
      path: `/v3/vault/payment-tokens?customer_id=${encodeURIComponent(firstCustomer)}`,
    })) as { payment_tokens?: { id: string }[] };
    saveFixture("02-payment-tokens-by-customer", list);
    const ids = (list.payment_tokens ?? []).map((t) => t.id);
    info(`tokens listed under the first token's customer.id: ${ids.length} (${ids.includes(token.id) ? "includes" : "does NOT include"} the new one)`);
  }
}

console.log(`\n================ TOKEN ID (pass to later steps) ================\n${token.id}\n`);
