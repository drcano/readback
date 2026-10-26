// Creates a real Readback agreement (merchant side): terms built by readback-core around the
// agent's fingerprint, a Vault setup token, the shopper's approval on PayPal, then the exchange
// for the payment token, whose ID is the agreement ID. Used for the Oct 21 hero seed agreement.
//
//   pnpm agreement:create <fingerprint> [periodDays=1] [end=2027-03-31]
//   (get the fingerprint with: pnpm --filter @readback/agent pubkey)
import { createInterface } from "node:readline/promises";
import { buildSetupTokenRequest, groupFingerprint, PaymentTokenSchema, parseTerms, type Terms } from "@readback/core";
import { paypal } from "./spike/paypal.ts";

const [fingerprint, periodArg = "1", end = "2027-03-31"] = process.argv.slice(2);
if (!fingerprint || !/^[A-Za-z0-9_-]{16}$/.test(fingerprint)) {
  throw new Error("Usage: pnpm agreement:create <16-char fingerprint> [periodDays] [end YYYY-MM-DD]");
}

const today = new Date().toISOString().slice(0, 10); // UTC date: agreements start today
const terms: Terms = {
  merchant: "Good Boy Provisions",
  sku: "GBP-SR24",
  qty: 1,
  periodDays: Number(periodArg),
  capCents: 6500,
  start: today,
  end,
  fingerprint,
};
const body = buildSetupTokenRequest(terms, { returnUrl: "https://example.com/readback/return", cancelUrl: "https://example.com/readback/cancel" });
if (!body.ok) throw new Error(body.error.message);
const termsText = body.value.payment_source.paypal.description;
if (!parseTerms(termsText).ok) throw new Error("internal: built terms don't parse");
console.log(`terms (${termsText.length} chars): ${termsText}`);
console.log(`fingerprint to compare on PayPal's page: ${groupFingerprint(fingerprint)}\n`);

// One setup token per (fingerprint, start date, cadence): rerunning today returns the same token.
const setup = (await paypal({
  method: "POST",
  path: "/v3/vault/setup-tokens",
  requestId: `rb-setup-${fingerprint}-${today}-${terms.periodDays}d`,
  body: body.value,
})) as { id: string; links: { rel: string; href: string }[] };
const approve = setup.links.find((l) => l.rel === "approve")?.href;
// The hero is Maya's; test agreements use a spare sandbox buyer, never Maya's or the judge account.
console.log(`Log in as the sandbox buyer this agreement is for (Maya only for the hero), check the fingerprint, and approve:\n  ${approve}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter once approved...");
rl.close();

const token = PaymentTokenSchema.parse(
  await paypal({
    method: "POST",
    path: "/v3/vault/payment-tokens",
    requestId: `rb-token-${setup.id}`,
    body: { payment_source: { token: { id: setup.id, type: "SETUP_TOKEN" } } },
  }),
);
const stored = token.payment_source.paypal.description;
console.log(`\nagreement (payment token) ID: ${token.id}`);
console.log(stored === termsText ? "PASS  PayPal stored the terms byte-for-byte" : `FAIL  PayPal stored: ${stored}`);
console.log(`\nOnly if this is the hero agreement, add to .env:  HERO_AGREEMENT_ID=${token.id}`);
