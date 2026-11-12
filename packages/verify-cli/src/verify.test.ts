import { buildMandate, formatTerms, generateAgentKey, sha256Hex, signMandate, authorizeCharge } from "@readbackhq/core";
import { describe, expect, it } from "vitest";
import { fakePayPal } from "./fake.ts";
import { paypalClient } from "./paypal-client.ts";
import { report, verifyCase } from "./verify.ts";

describe("readback-verify", () => {
  it("rebuilds a charge from PayPal and prints the checks", async () => {
    const pp = fakePayPal();
    const agent = await generateAgentKey(true);
    const terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint };
    pp.tokens.set("tok1", { id: "tok1", payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA00000001" } } });
    pp.clock.now = "2026-11-08T15:00:00Z";
    const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: "tok1", terms, termsHash: await sha256Hex(formatTerms(terms)) }, Date.parse(pp.clock.now) / 1000, "jti-verify-01");
    if (!m.ok) throw new Error(m.error.code);
    const jws = await signMandate(m.value, agent.privateKey, agent.publicJwk);
    const d = await authorizeCharge({ jws, token: { id: "tok1", payment_source: { paypal: { description: formatTerms(terms) } } }, merchant: "Good Boy Provisions", itemName: "Salmon", nowSec: Date.parse(pp.clock.now) / 1000 });
    if (!d.allow) throw new Error("gate");
    const created = (await (await pp.fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", { method: "POST", headers: { "PayPal-Request-Id": d.requestIds.create }, body: JSON.stringify(d.orderRequest) })).json()) as { purchase_units: { payments: { captures: { id: string }[] } }[] };
    const captureId = created.purchase_units[0]!.payments.captures[0]!.id;

    const r = await verifyCase(captureId, paypalClient({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }, pp.fetch), new Date("2026-11-09T00:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = report(captureId, r.result);
    expect(text).toContain("PASS  3   Requested by her agent");
    expect(text).toMatch(/Classification: row 11/); // not shipped yet
    expect(await verifyCase("PP-D-NOPE", paypalClient({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }, pp.fetch), new Date())).toMatchObject({ ok: false });
  });
});
