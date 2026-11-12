// Audit finding 2, kept as a regression test: a merchant labels charges to ITS OWN wallet with the
// shopper's agreement prefix to fake a history. Only PayPal-verified captures may count.
import { authorizeCharge, buildMandate, customId, evaluateCase, formatTerms, generateAgentKey, PaymentTokenSchema, sha256Hex, signMandate, type Terms } from "@readbackhq/core";
import { describe, expect, it } from "vitest";
import { buildCaseBundle } from "./cases.ts";
import { fakePayPal } from "./fake.ts";
import { paypalClient } from "./paypal-client.ts";

describe("history provenance", () => {
  it("padded labels on the merchant's own wallet don't count; verified charges do", async () => {
    const fake = fakePayPal();
    const pp = paypalClient({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" }, fake.fetch);
    const agent = await generateAgentKey(true);
    const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint };
    const text = formatTerms(terms);
    const th = await sha256Hex(text);
    const setup = await pp.post("/v3/vault/setup-tokens", "s1", { payment_source: { paypal: { description: text } } }, PaymentTokenSchema.pick({ id: true }));
    if (!setup.ok) throw new Error("setup");
    fake.approve(setup.data.id);
    const tok = await pp.post("/v3/vault/payment-tokens", "t1", { payment_source: { token: { id: setup.data.id, type: "SETUP_TOKEN" } } }, PaymentTokenSchema);
    if (!tok.ok) throw new Error("token");
    const maya = tok.data.id;
    fake.tokens.set("MERCHANT-OWN-WALLET", { id: "MERCHANT-OWN-WALLET", payment_source: { paypal: { payer_id: "SAM0000001" } } });

    const charge = async (iso: string, jti: string) => {
      fake.clock.now = iso;
      const iat = Date.parse(iso) / 1000 - 10;
      const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: maya, terms, termsHash: th }, iat, jti);
      if (!m.ok) throw new Error(m.error.code);
      const d = await authorizeCharge({ jws: await signMandate(m.value, agent.privateKey, agent.publicJwk), token: tok.data, merchant: "Good Boy Provisions", itemName: "Salmon", nowSec: iat + 5 });
      if (!d.allow) throw new Error("gate");
      const o = await pp.post("/v2/checkout/orders", d.requestIds.create, d.orderRequest, PaymentTokenSchema.pick({ id: true }));
      if (!o.ok) throw new Error("order");
      await pp.post(`/v2/checkout/orders/${o.data.id}/track`, `trk-${jti}`, {}, PaymentTokenSchema.pick({ id: true }));
      return [...fake.orders.values()].map((x) => (x as { purchase_units: { payments: { captures: { id: string }[] } }[] }).purchase_units[0]!.payments.captures[0]!.id).pop()!;
    };
    const verdictFor = async (captureId: string) => {
      const lookup = await buildCaseBundle(fake.openDispute(captureId, "UNAUTHORISED"), pp, new Date("2026-11-10T15:00:00Z"));
      if (!lookup.ok) throw new Error(lookup.message);
      return (await evaluateCase(lookup.bundle)).classification;
    };

    // The padding: two charges to the merchant's own wallet, labeled with Maya's prefix.
    for (const [day, p] of [["2026-10-29", 9], ["2026-10-30", 10]] as const) {
      fake.clock.now = `${day}T15:00:00Z`;
      await pp.post("/v2/checkout/orders", `pad-${p}`, {
        intent: "CAPTURE",
        payment_source: { paypal: { vault_id: "MERCHANT-OWN-WALLET" } },
        purchase_units: [{ custom_id: customId(maya, th, p, "f".repeat(64)), invoice_id: `PAD-${p}`, amount: { currency_code: "USD", value: "0.01" } }],
      }, PaymentTokenSchema.pick({ id: true }));
    }
    const first = await charge("2026-11-08T15:00:00Z", "jti-real-0001");
    expect(await verdictFor(first)).toMatchObject({ row: 12, suggestion: null }); // padding didn't count

    // Real history: two of Maya's own earlier charges (8+ days before) make the same case row 13.
    await charge("2026-10-22T15:00:00Z", "jti-real-0002");
    await charge("2026-10-24T15:00:00Z", "jti-real-0003");
    expect(await verdictFor(first)).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR" });

    // Audit Oct 25: a refunded earlier charge isn't evidence she accepted it, so it stops counting.
    const earlier = [...fake.orders.values()].find((o) => (o as { purchase_units: { invoice_id?: string }[] }).purchase_units[0]!.invoice_id?.endsWith("-P002"));
    (earlier as { purchase_units: { payments: { captures: { status: string }[] } }[] }).purchase_units[0]!.payments.captures[0]!.status = "REFUNDED";
    expect(await verdictFor(first)).toMatchObject({ row: 12, suggestion: null });
  });
});
