// The demo-critical path (CLAUDE.md §9), end to end against the fake sandbox:
// approve (token exists) → signed charges → PayPal refuses the duplicate → a dispute arrives →
// the case shows SELLER_FAVOR for the signed charge and BUYER_FAVOR for the merchant's direct charge.
import { buildMandate, evaluateCase, formatTerms, generateAgentKey, sha256Hex, signMandate, type Terms } from "@readback/core";
import { describe, expect, it } from "vitest";
import { buildCaseBundle } from "./cases";
import { checkout } from "./checkout";
import { paypalClient } from "./paypal/client";
import { fakePayPal } from "./paypal/fake";

const TOKEN = "heroagreement01";
const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };

describe("demo-critical path (fake sandbox)", () => {
  it("same claim, two verdicts", async () => {
    const pp = fakePayPal();
    const client = () => paypalClient(ENV, pp.fetch);
    const agent = await generateAgentKey(true);
    const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint };
    const termsText = formatTerms(terms);
    pp.tokens.set(TOKEN, { id: TOKEN, payment_source: { paypal: { description: termsText, payer_id: "MAYA00000001" } } });
    const termsHash = await sha256Hex(termsText);

    // The agent signs a reorder at `iso`; the merchant's gate charges it.
    const reorder = async (iso: string, jti: string) => {
      pp.clock.now = iso;
      const nowSec = Date.parse(iso) / 1000;
      const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: TOKEN, terms, termsHash }, nowSec - 5, jti);
      if (!m.ok) throw new Error(m.error.code);
      return checkout(await signMandate(m.value, agent.privateKey, agent.publicJwk), client(), nowSec);
    };

    // Seed charges (Oct 21, 23, 28), then the hero charge on Nov 8.
    for (const [day, jti] of [["2026-10-21", "seed-0001"], ["2026-10-23", "seed-0002"], ["2026-10-28", "seed-0003"]] as const) {
      expect((await reorder(`${day}T15:00:00Z`, jti)).ok).toBe(true);
    }
    const hero = await reorder("2026-11-08T15:00:00Z", "hero-0001");
    expect(hero.ok).toBe(true);

    // Sam ships it and adds the tracker (POST /v2/checkout/orders/{id}/track).
    if (!hero.ok) throw new Error("hero charge failed");
    await pp.fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${hero.orderId}/track`, {
      method: "POST",
      headers: { "PayPal-Request-Id": `rb-track-${hero.orderId}` },
      body: JSON.stringify({ capture_id: hero.captureId, tracking_number: "9400100000000000000000", carrier: "USPS", notify_payer: true }),
    });

    // Asked again the same day: PayPal itself refuses.
    const again = await reorder("2026-11-08T15:30:00Z", "hero-0002");
    expect(again).toMatchObject({ ok: false, failures: [{ code: "ALREADY_ORDERED_THIS_PERIOD" }] });

    // The twist: the merchant charges her saved wallet directly, no mandate, no labels.
    pp.clock.now = "2026-11-09T10:00:00Z";
    const direct = (await (await pp.fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `rb-direct-${TOKEN}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        payment_source: { paypal: { vault_id: TOKEN } },
        purchase_units: [{ invoice_id: `RB-${TOKEN}-DIRECT`, description: termsText, amount: { currency_code: "USD", value: "59.00", breakdown: { item_total: { currency_code: "USD", value: "59.00" } } }, items: [{ name: "Salmon & Rice Adult (24 lb)", sku: "GBP-SR24", quantity: "1", unit_amount: { currency_code: "USD", value: "59.00" } }] }],
      }),
    })).json()) as { purchase_units: { payments: { captures: { id: string }[] } }[] };
    const directCapture = direct.purchase_units[0]!.payments.captures[0]!.id;

    // Maya disputes both: "my AI bought that."
    const heroDispute = pp.openDispute(hero.captureId, "UNAUTHORISED");
    const twistDispute = pp.openDispute(directCapture, "UNAUTHORISED");

    const now = new Date("2026-11-10T12:00:00Z");
    const verdict = async (id: string) => {
      const lookup = await buildCaseBundle(id, client(), now);
      if (!lookup.ok) throw new Error(lookup.message);
      return (await evaluateCase(lookup.bundle)).classification;
    };
    expect(await verdict(heroDispute)).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR" });
    expect(await verdict(twistDispute)).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });

    // Preview mode on the hero capture reads the same way, "if disputed".
    expect(await verdict(hero.captureId)).toMatchObject({ row: 13 });
  });
});
