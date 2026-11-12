import { formatTerms, generateAgentKey, planName, type Terms } from "@readbackhq/core";
import { describe, expect, it } from "vitest";
import { approvalConcept } from "./concept";
import { paypalClient } from "./paypal/client";
import { fakePayPal } from "./paypal/fake";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };

describe("approvalConcept (/proposal)", () => {
  it("shows the terms PayPal stores, and today's line built from the same terms", async () => {
    const pp = fakePayPal();
    const key = await generateAgentKey(true);
    const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 30, capCents: 6500, start: "2026-10-15", end: "2027-03-31", fingerprint: key.fingerprint };
    pp.tokens.set("tok9", { id: "tok9", payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA9" } } });
    const c = await approvalConcept(paypalClient(ENV, pp.fetch), "tok9", new Date("2026-10-26T12:00:00Z"));
    expect(c).toMatchObject({ source: "live", tokenId: "tok9", stored: formatTerms(terms), terms });
    expect(c.today).toBe(planName(terms)); // the plan name Readback sends: PayPal's only line today
    expect(c.today).toContain(`agent ${key.fingerprint.slice(0, 4)}`);
  });

  it("falls back to the labeled hero fixture when the agreement can't be read", async () => {
    const gone = await approvalConcept(paypalClient(ENV, fakePayPal().fetch), "nosuchtoken", new Date());
    const unset = await approvalConcept(null, undefined, new Date());
    for (const c of [gone, unset]) {
      expect(c.source).toBe("example");
      expect(c.today).toBe(planName(c.terms));
      expect(c.terms.sku).toBe("GBP-SR24");
    }
  });
});
