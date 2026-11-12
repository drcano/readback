// Audit Oct 25 regression suite (independent review; see docs/decisions/0006-audit-oct25.md).
// Probe: a merchant charges Maya's wallet twice for one signed request, leaving the second charge
// unlabeled. History only sees rb1:<tokenId>: labels, so the labeled copy is "the single charge in
// its period" and a DUPLICATE_TRANSACTION dispute on it is suggested SELLER_FAVOR.
import { authorizeCharge, buildMandate, evaluateCase, formatTerms, generateAgentKey, PaymentTokenSchema, sha256Hex, signMandate, type Terms } from "@readbackhq/core";
import { buildCaseBundle, paypalClient } from "@readbackhq/verify";
import { fakePayPal } from "@readbackhq/verify/fake";
import { z } from "zod";
import { describe, expect, it } from "vitest";

const Created = z.object({ id: z.string(), purchase_units: z.array(z.object({ payments: z.object({ captures: z.array(z.object({ id: z.string() })) }) })) });

describe("sibling charge blindness", () => {
  it("an unlabeled twin charge can't make the labeled copy look like the only one (row 9 makes no suggestion)", async () => {
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

    // One genuine signed request from Maya's agent.
    fake.clock.now = "2026-11-08T15:00:00Z";
    const iat = Date.parse(fake.clock.now) / 1000 - 10;
    const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: maya, terms, termsHash: th }, iat, "jti-0001");
    if (!m.ok) throw new Error(m.error.code);
    const jws = await signMandate(m.value, agent.privateKey, agent.publicJwk);
    const d = await authorizeCharge({ jws, token: tok.data, merchant: "Good Boy Provisions", itemName: "Salmon", nowSec: iat + 5 });
    if (!d.allow) throw new Error("gate");
    const a = await pp.post("/v2/checkout/orders", d.requestIds.create, d.orderRequest, Created);
    if (!a.ok) throw new Error("order A");
    const capA = a.data.purchase_units[0]!.payments.captures[0]!.id;

    // The merchant charges the same wallet again 60s later: same amount, same JWS, NO labels.
    fake.clock.now = "2026-11-08T15:01:00Z";
    const req = structuredClone(d.orderRequest) as { purchase_units: Record<string, unknown>[] };
    delete req.purchase_units[0]!["custom_id"];
    req.purchase_units[0]!["invoice_id"] = "GBP-20261108-0917";
    const bOrder = await pp.post("/v2/checkout/orders", "merchant-twin", req, Created);
    if (!bOrder.ok) throw new Error("order B");
    const capB = bOrder.data.purchase_units[0]!.payments.captures[0]!.id;

    // The unrequested twin itself: no link → row 1, no suggestion (accepted T3/T24).
    const twin = await buildCaseBundle(fake.openDispute(capB, "DUPLICATE_TRANSACTION"), pp, new Date("2026-11-09T15:00:00Z"));
    if (!twin.ok) throw new Error(twin.message);
    expect((await evaluateCase(twin.bundle)).classification).toMatchObject({ row: 1, suggestion: null });

    // Maya was charged twice; she disputes the labeled one as a duplicate. Well after the 3h lag.
    const lookup = await buildCaseBundle(fake.openDispute(capA, "DUPLICATE_TRANSACTION"), pp, new Date("2026-11-09T15:00:00Z"));
    if (!lookup.ok) throw new Error(lookup.message);
    expect(lookup.bundle.history.map((h) => h.captureId)).toHaveLength(1); // the twin is invisible
    const r = await evaluateCase(lookup.bundle);
    expect(r.classification).toMatchObject({ row: 9, suggestion: null });
  });
});
