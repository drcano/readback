// pnpm seed:charge [tokenId] — the labeled pre-gate seed path (SPEC §2).
// Signs one reorder with apps/agent's seed signer, then charges it as the merchant through
// readback-core's gate decision. The signer runs as a separate process that receives only
// AGENT_PRIVATE_KEY (from apps/agent/.env); this process holds only the PayPal credentials (.env).
// Run it on Oct 21, 23 and 28 at minimum, then daily from Nov 1 (CLAUDE.md §8).
import { spawnSync } from "node:child_process";
import { authorizeCharge, denialFromPayPalIssue, PaymentTokenSchema } from "@readback/core";
import { saveFixture } from "./spike/fixtures.ts";
import { issues, paypal, paypalRaw } from "./spike/paypal.ts";

const MERCHANT = "Good Boy Provisions";
const ITEM = { sku: "GBP-SR24", name: "Salmon & Rice Adult (24 lb)", unitCents: 6499 };

const tokenId = process.argv[2] ?? process.env["HERO_AGREEMENT_ID"];
if (!tokenId) throw new Error("Usage: pnpm seed:charge <tokenId>  (or set HERO_AGREEMENT_ID in .env)");

// 1. The agreement, as PayPal holds it. 404 means it was cancelled.
const tokenRes = await paypalRaw({ method: "GET", path: `/v3/vault/payment-tokens/${tokenId}` });
const token = tokenRes.status === 404 ? null : PaymentTokenSchema.parse(tokenRes.json);
const terms = token?.payment_source.paypal.description;
if (!terms) throw new Error(`Agreement ${tokenId} is not active or has no terms (HTTP ${tokenRes.status}).`);

// 2. Ask the agent's signer. A child process with a clean environment: PATH only, plus its own .env.
const signer = spawnSync(
  process.execPath,
  ["--env-file=apps/agent/.env", "apps/agent/src/sign-cli.ts"],
  { input: JSON.stringify({ agreement: tokenId, terms, sku: ITEM.sku, qty: 1, unitCents: ITEM.unitCents }), env: { PATH: process.env["PATH"] ?? "" }, encoding: "utf8" },
);
const signed = JSON.parse(signer.stdout || "{}") as { jws?: string; error?: { code: string; message: string } };
if (!signed.jws) {
  console.error("Agent refused to sign:", signed.error ?? signer.stderr.split("\n").slice(0, 3).join(" "));
  process.exit(1);
}

// 3. The gate decision (pure, readback-core). Deny means no PayPal call at all.
const decision = await authorizeCharge({ jws: signed.jws, token, merchant: MERCHANT, itemName: ITEM.name, nowSec: Math.floor(Date.now() / 1000) });
if (!decision.allow) {
  for (const f of decision.failures) console.error(`Refused (${f.code}): ${f.message}`);
  process.exit(1);
}
console.log(`invoice_id ${decision.invoiceId}\ncustom_id  ${decision.customId}`);

// 4. Charge the saved wallet. Deterministic request IDs make a rerun of this exact mandate a no-op.
const order = await paypalRaw({ method: "POST", path: "/v2/checkout/orders", requestId: decision.requestIds.create, body: decision.orderRequest });
if (!order.ok) {
  for (const issue of issues(order.json)) console.error(denialFromPayPalIssue(issue).message);
  process.exit(1);
}
const o = order.json as { id: string; status: string };
let status = o.status;
if (status !== "COMPLETED") {
  const cap = (await paypal({ method: "POST", path: `/v2/checkout/orders/${o.id}/capture`, requestId: decision.requestIds.capture, body: {} })) as { status: string };
  status = cap.status;
}
console.log(`order ${o.id} ${status}`);

// 5. Ship it, as the merchant would (check 10 reads the tracker). A fake USPS number: sandbox only.
const got = (await paypal({ method: "GET", path: `/v2/checkout/orders/${o.id}` })) as { purchase_units: { payments?: { captures?: { id: string }[] } }[] };
const captureId = got.purchase_units[0]?.payments?.captures?.[0]?.id;
// A failed tracker must not lose the fixture: the charge already happened and can't be redone.
if (captureId) {
  try {
    await paypal({
      method: "POST",
      path: `/v2/checkout/orders/${o.id}/track`,
      requestId: decision.requestIds.track,
      body: { capture_id: captureId, tracking_number: `94001112025558${decision.mandateHash.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`, carrier: "USPS", items: [{ name: ITEM.name, sku: ITEM.sku, quantity: "1" }] },
    });
    console.log("shipped (USPS tracker added)");
  } catch (e) {
    console.error(`Tracker not added (rerun: pnpm spike:tracking ${o.id}): ${String(e).split("\n")[0]}`);
  }
}
// Product-shaped fixtures for readback-core's tests come from here, not from spike steps 3-5
// (those build orders by hand to probe PayPal). Scrubbed of personal data on save.
saveFixture(`seed-${decision.invoiceId}-order`, await paypal({ method: "GET", path: `/v2/checkout/orders/${o.id}` }));
