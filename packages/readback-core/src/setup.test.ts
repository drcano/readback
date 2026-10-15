import { describe, expect, it } from "vitest";
import { buildSetupTokenRequest, planName } from "./setup.ts";
import { groupFingerprint } from "./thumbprint.ts";
import { STORY_TERMS, STORY_TERMS_STRING } from "./test-helpers.ts";

const urls = { returnUrl: "https://example.com/return", cancelUrl: "https://example.com/cancel" };

describe("setup token request", () => {
  it("puts the canonical terms in description and a display-only plan alongside", () => {
    const r = buildSetupTokenRequest(STORY_TERMS, urls);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pp = r.value.payment_source.paypal;
    expect(pp.description).toBe(STORY_TERMS_STRING);
    expect(pp.permit_multiple_payment_tokens).toBe(true);
    expect(pp.usage_pattern).toBe("RECURRING_PREPAID"); // PayPal refuses a billing_plan with UNSCHEDULED_PREPAID (spike step 2)
    expect(pp.billing_plan.name).toBe(`GBP-SR24, up to 1 per order every 30 days, max USD 65.00 each, until 2027-03-31, agent ${groupFingerprint(STORY_TERMS.fingerprint)}`);
    expect(pp.billing_plan.billing_cycles[0]).toMatchObject({ total_cycles: 6, frequency: { interval_unit: "DAY", interval_count: 30 }, start_date: STORY_TERMS.start, pricing_scheme: { price: { value: "65.00" } } });
    expect(pp.billing_plan.one_time_charges.total_amount.value).toBe("0.00");
  });

  it("demo cadence reads naturally and counts daily cycles", () => {
    const daily = { ...STORY_TERMS, periodDays: 1, start: "2026-10-21" };
    expect(planName(daily)).toContain("every day");
    const r = buildSetupTokenRequest(daily, urls);
    expect(r.ok && r.value.payment_source.paypal.billing_plan.billing_cycles[0].total_cycles).toBe(162);
  });

  it("refuses what PayPal's plan display can't express", () => {
    expect(buildSetupTokenRequest({ ...STORY_TERMS, periodDays: 400 }, urls)).toMatchObject({ ok: false, error: { code: "PERIOD_TOO_LONG" } });
    expect(buildSetupTokenRequest({ ...STORY_TERMS, merchant: "A".repeat(24), sku: "B".repeat(16), qty: 999, end: "2027-03-31" }, urls).ok).toBe(true);
  });

  it("refuses a fingerprint PayPal's plan name can't show (no _ allowed)", () => {
    expect(buildSetupTokenRequest({ ...STORY_TERMS, fingerprint: "ab_defghijklmnop" }, urls)).toMatchObject({ ok: false, error: { code: "PLAN_NAME_INVALID" } });
  });

  it("worst-case plan name stays within 127 allowed characters", () => {
    const worst = { ...STORY_TERMS, merchant: "Abcdefghij Klmnopqrst Uv", sku: "ABCDEFGHIJKLMNOP", qty: 999, periodDays: 365, capCents: 999_999 };
    expect(planName(worst).length).toBeLessThanOrEqual(127);
  });
});
