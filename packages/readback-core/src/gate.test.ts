import { beforeAll, describe, expect, it } from "vitest";
import type { PaymentToken } from "./case.ts";
import { denialFromPayPalIssue, authorizeCharge, type GateInput } from "./gate.ts";
import { sha256Hex } from "./hash.ts";
import { buildMandate, signMandate } from "./mandate.ts";
import { formatTerms, type Terms } from "./terms.ts";
import { sec } from "./test-helpers.ts";
import { type AgentKey, generateAgentKey } from "./thumbprint.ts";

const TOKEN = "8kd73hs9ab";
const NOW = sec("2026-11-08T15:00:00Z");
let agent: AgentKey;
let attacker: AgentKey;
let terms: Terms;
let termsText: string;
let token: PaymentToken;

beforeAll(async () => {
  agent = await generateAgentKey(true);
  attacker = await generateAgentKey(true);
  terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint };
  termsText = formatTerms(terms);
  token = { id: TOKEN, payment_source: { paypal: { description: termsText, payer_id: "FAKEPAYER0001" } } };
});

async function signed(over: { unitCents?: number; sku?: string; at?: number; key?: AgentKey; tokenId?: string } = {}) {
  const termsHash = await sha256Hex(termsText);
  // Build against a permissive copy of the terms so we can produce out-of-terms requests to test the gate.
  const loose = { ...terms, sku: over.sku ?? terms.sku, capCents: 999_999 };
  const m = buildMandate({ sku: over.sku ?? "GBP-SR24", qty: 1, unitCents: over.unitCents ?? 6499 }, { tokenId: over.tokenId ?? TOKEN, terms: loose, termsHash }, over.at ?? NOW - 5, "jti-gate-0001");
  if (!m.ok) throw new Error(m.error.code);
  const key = over.key ?? agent;
  return signMandate(m.value, key.privateKey, key.publicJwk);
}

const input = async (over: Partial<GateInput> = {}): Promise<GateInput> => ({
  jws: await signed(),
  token,
  merchant: "Good Boy Provisions",
  itemName: "Salmon & Rice Adult (24 lb)",
  nowSec: NOW,
  ...over,
});
const codes = async (i: GateInput) => {
  const d = await authorizeCharge(i);
  return d.allow ? "ALLOW" : d.failures.map((f) => f.code);
};

describe("authorizeCharge", () => {
  it("allows an in-terms signed request and builds the exact order body", async () => {
    const i = await input();
    const d = await authorizeCharge(i);
    expect(d.allow).toBe(true);
    if (!d.allow) return;
    expect(d.invoiceId).toBe(`RB-${TOKEN}-P019`); // Nov 8 is day 19 of a 1-day cadence from Oct 21
    expect(d.customId).toMatch(new RegExp(`^rb1:${TOKEN}:[0-9a-f]{16}:p019:[0-9a-f]{16}$`));
    expect(d.requestIds.create).toBe(`rb-${d.mandateHash.slice(0, 40)}`);
    expect(d.orderRequest).toEqual({
      intent: "CAPTURE",
      payment_source: { paypal: { vault_id: TOKEN, stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "UNSCHEDULED_PREPAID" } } },
      purchase_units: [{
        description: termsText,
        invoice_id: d.invoiceId,
        custom_id: d.customId,
        amount: { currency_code: "USD", value: "64.99", breakdown: { item_total: { currency_code: "USD", value: "64.99" } } },
        items: [{ name: "Salmon & Rice Adult (24 lb)", sku: "GBP-SR24", quantity: "1", unit_amount: { currency_code: "USD", value: "64.99" }, description: i.jws, category: "PHYSICAL_GOODS" }],
      }],
    });
  });

  it("is deterministic: the same mandate yields the same labels and request IDs", async () => {
    const i = await input();
    const [a, b] = [await authorizeCharge(i), await authorizeCharge(i)];
    expect(a).toEqual(b);
  });

  it("denies, with reasons, every way a request can be wrong", async () => {
    expect(await codes(await input({ jws: "garbage" }))).toEqual(["JWS_MALFORMED"]);
    expect(await codes(await input({ jws: await signed({ key: attacker }) }))).toEqual(["KEY_NOT_APPROVED"]);
    expect(await codes(await input({ jws: await signed({ unitCents: 6501 }) }))).toEqual(["OVER_CAP"]);
    expect(await codes(await input({ jws: await signed({ sku: "GBP-PREMIUM" }) }))).toEqual(["SKU_NOT_APPROVED"]);
    expect(await codes(await input({ merchant: "Other Shop" }))).toEqual(["WRONG_MERCHANT"]);
    expect(await codes(await input({ nowSec: NOW + 400 }))).toEqual(["EXPIRED"]);
    expect(await codes(await input({ nowSec: NOW - 120 }))).toEqual(["NOT_YET_VALID"]);
  });

  it("denies when PayPal has no active agreement", async () => {
    expect(await codes(await input({ token: null }))).toEqual(["AGREEMENT_NOT_ACTIVE"]);
    expect(await codes(await input({ jws: await signed({ tokenId: "otheragreement" }) }))).toEqual(["AGREEMENT_NOT_ACTIVE"]);
  });

  it("denies when the token's terms are missing or unreadable", async () => {
    const bad = { ...token, payment_source: { paypal: { description: "not terms" } } };
    expect(await codes(await input({ token: bad }))).toEqual(["TERMS_UNREADABLE"]);
    const none = { ...token, payment_source: { paypal: {} } };
    expect(await codes(await input({ token: none }))).toEqual(["TERMS_UNREADABLE"]);
  });

  it("audit finding 4: no charge in the last minute of the agreement, or before it starts", async () => {
    const last = sec("2027-03-31T23:59:58Z");
    const jws = await signed({ at: last });
    expect(await codes(await input({ jws, nowSec: last + 3 }))).toEqual(["OUTSIDE_DATES"]);
    const early = await signed({ at: sec("2026-10-21T00:00:30Z") });
    expect(await codes(await input({ jws: early, nowSec: sec("2026-10-20T23:59:50Z") }))).toEqual(["OUTSIDE_DATES"]);
    const ok = await signed({ at: sec("2027-03-31T23:58:00Z") });
    expect(await codes(await input({ jws: ok, nowSec: sec("2027-03-31T23:58:05Z") }))).toBe("ALLOW");
  });

  it("denies a request signed in a previous period (replay next period)", async () => {
    const yesterday = await signed({ at: NOW - 86_400 });
    expect(await codes(await input({ jws: yesterday }))).toEqual(["EXPIRED"]);
  });

  it("maps PayPal refusals to plain-language denials", () => {
    expect(denialFromPayPalIssue("DUPLICATE_INVOICE_ID").code).toBe("ALREADY_ORDERED_THIS_PERIOD");
    expect(denialFromPayPalIssue("INVALID_VAULT_ID").code).toBe("AGREEMENT_NOT_ACTIVE");
    expect(denialFromPayPalIssue("AGREEMENT_ALREADY_CANCELLED").code).toBe("AGREEMENT_NOT_ACTIVE");
    expect(denialFromPayPalIssue("INSTRUMENT_DECLINED")).toEqual({ code: "PAYPAL_REFUSED", message: "PayPal refused the charge (INSTRUMENT_DECLINED)." });
  });
});

