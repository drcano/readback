import { beforeAll, describe, expect, it } from "vitest";
import { generateDidKey, type KeyPair } from "./did.ts";
import { authorize, checkRules, type GateRequest, periodMs } from "./gate.ts";
import { type Clip, nextClip, verifyChain } from "./ledger.ts";
import type { IntentMandate } from "./schemas.ts";
import { cartMandate, intentMandate, NOW } from "./test-fixtures.ts";
import { signCredential } from "./vc.ts";

let shopper: KeyPair;
let agentDid: string;
let mandate: IntentMandate;
let jwt: string;

beforeAll(async () => {
  shopper = await generateDidKey();
  agentDid = (await generateDidKey()).did;
  mandate = intentMandate(shopper.did, agentDid);
  jwt = await signMandate(mandate);
});

function signMandate(subject: IntentMandate): Promise<string> {
  return signCredential({
    type: "IntentMandate",
    subject,
    id: subject.id,
    issuer: shopper.did,
    holder: agentDid,
    privateKey: shopper.privateKey,
    validFrom: "2026-10-01T00:00:00Z",
    expiresAt: "2028-01-01T00:00:00Z",
  });
}

const request = (over: Partial<GateRequest> = {}): GateRequest => ({
  mandateJwt: jwt,
  expectedShopper: shopper.did,
  cart: cartMandate(),
  chain: [],
  now: NOW,
  ...over,
});

const priorAllow = (chain: Clip[], timestamp: string, amount_cents: string, quantity: string): Clip[] => [
  ...chain,
  nextClip(chain, {
    type: "GATE_ALLOW",
    refs: { intent_mandate_id: "im_1", amount_cents, quantity, currency: "USD" },
    reasons: [],
    timestamp,
  }),
];

describe("authorize", () => {
  it("allows an in-policy cart and returns a GATE_ALLOW clip that chains", async () => {
    const decision = await authorize(request());
    expect(decision.allow).toBe(true);
    expect(decision.clip).toMatchObject({
      type: "GATE_ALLOW",
      seq: 0,
      refs: { intent_mandate_id: "im_1", cart_mandate_id: "cm_1", amount_cents: "2250", quantity: "1" },
    });
    expect(decision.clip.hash).toMatch(/^[0-9a-f]{64}$/); // goes into PayPal custom_id
    expect(verifyChain([decision.clip])).toEqual({ ok: true });
  });

  it("denies a bad signature and still returns a GATE_DENY clip", async () => {
    const decision = await authorize(request({ mandateJwt: "garbage" }));
    expect(decision.allow).toBe(false);
    expect(decision.clip.type).toBe("GATE_DENY");
    expect(decision.clip.reasons[0]).toMatch(/^SIGNATURE_INVALID/);
  });

  it("denies when the mandate was signed by a different shopper", async () => {
    const other = await generateDidKey();
    const decision = await authorize(request({ expectedShopper: other.did }));
    expect(decision.clip.reasons).toEqual(["SIGNATURE_INVALID:unexpected issuer"]);
  });

  it("denies when the mandate body names a different issuer than the signer", async () => {
    const decision = await authorize(request({ mandateJwt: await signMandate({ ...mandate, issuer: agentDid }) }));
    expect(decision.clip.reasons).toEqual(["MANDATE_ISSUER_MISMATCH"]);
  });

  it("denies a malformed cart (unknown field, wrong types)", async () => {
    for (const cart of [{ ...cartMandate(), discount: "100%" }, { id: 1 }, null]) {
      const decision = await authorize(request({ cart }));
      expect(decision.clip.reasons).toEqual(["CART_MALFORMED"]);
    }
  });

  it("denies when the chain has been tampered with", async () => {
    const chain = priorAllow([], "2026-10-19T00:00:00Z", "100", "1");
    const tampered = [{ ...chain[0]!, refs: { ...chain[0]!.refs, amount_cents: "0" } }];
    const decision = await authorize(request({ chain: tampered }));
    expect(decision.clip.reasons).toEqual(["CHAIN_INVALID:hash mismatch"]);
  });

  it("denies after revocation", async () => {
    const chain = [nextClip([], { type: "MANDATE_REVOKED", refs: { intent_mandate_id: "im_1" }, reasons: [], timestamp: "2026-10-19T00:00:00Z" })];
    const decision = await authorize(request({ chain }));
    expect(decision.clip).toMatchObject({ type: "GATE_DENY", seq: 1, reasons: ["MANDATE_REVOKED"] });
  });
});

describe("checkRules", () => {
  const check = (cartOver = {}, chain: Clip[] = [], now = NOW, m: IntentMandate = mandate) =>
    checkRules(m, cartMandate(cartOver), chain, now);

  it("passes the baseline", () => {
    expect(check()).toEqual([]);
  });

  it("flags a cart for another mandate", () => {
    expect(check({ intent_mandate_id: "im_other" })).toEqual(["CART_FOR_OTHER_MANDATE"]);
  });

  it("flags not-yet-valid and expired mandates", () => {
    expect(check({}, [], new Date("2026-10-13T00:00:00Z"))).toEqual(["MANDATE_NOT_YET_VALID"]);
    expect(check({}, [], new Date("2027-10-14T00:00:00Z"))).toEqual(["MANDATE_EXPIRED"]);
  });

  it("flags a replayed cart", () => {
    const chain = [nextClip([], { type: "GATE_ALLOW", refs: { intent_mandate_id: "im_1", cart_mandate_id: "cm_1", amount_cents: "2250", quantity: "1" }, reasons: [], timestamp: "2026-10-19T00:00:00Z" })];
    expect(check({}, chain)).toEqual(["CART_ALREADY_AUTHORIZED"]);
  });

  it("flags a merchant redirect", () => {
    expect(check({ merchant: "evil_merchant" })).toEqual(["MERCHANT_NOT_ALLOWED"]);
  });

  it("flags a SKU swap", () => {
    const items = [{ sku: "GOLD-BAR", qty: 1, unit_price: { value: "22.50", currency: "USD" } }];
    expect(check({ items })).toEqual(["SKU_NOT_ALLOWED:GOLD-BAR"]);
  });

  it("flags a price over the unit cap", () => {
    const items = [{ sku: "COFFEE-1KG", qty: 1, unit_price: { value: "25.01", currency: "USD" } }];
    expect(check({ items, total: { value: "25.01", currency: "USD" } })).toEqual(["UNIT_PRICE_OVER_CAP:COFFEE-1KG"]);
  });

  it("allows a price exactly at the unit cap", () => {
    const items = [{ sku: "COFFEE-1KG", qty: 1, unit_price: { value: "25", currency: "USD" } }];
    expect(check({ items, total: { value: "25.00", currency: "USD" } })).toEqual([]);
  });

  it("flags currency mismatches on items and total", () => {
    const items = [{ sku: "COFFEE-1KG", qty: 1, unit_price: { value: "22.50", currency: "EUR" } }];
    expect(check({ items, total: { value: "22.50", currency: "EUR" } })).toEqual([
      "CURRENCY_MISMATCH:COFFEE-1KG",
      "CURRENCY_MISMATCH:total",
    ]);
  });

  it("flags a total that does not match the items", () => {
    expect(check({ total: { value: "2.25", currency: "USD" } })).toEqual(["CART_TOTAL_MISMATCH"]);
  });

  it("flags a quantity bump past the period cap", () => {
    const items = [{ sku: "COFFEE-1KG", qty: 3, unit_price: { value: "10.00", currency: "USD" } }];
    expect(check({ items, total: { value: "30.00", currency: "USD" } })).toEqual(["PERIOD_QUANTITY_OVER_CAP"]);
  });

  it("counts earlier allows in the window toward amount and quantity caps", () => {
    let chain = priorAllow([], "2026-10-01T00:00:00Z", "2250", "1");
    chain = priorAllow(chain, "2026-10-10T00:00:00Z", "2000", "1");
    expect(check({}, chain)).toEqual(["PERIOD_AMOUNT_OVER_CAP", "PERIOD_QUANTITY_OVER_CAP"]);
  });

  it("ignores allows outside the window and for other mandates", () => {
    const old = priorAllow([], "2026-09-01T00:00:00Z", "5000", "2");
    const other = [
      ...old,
      nextClip(old, { type: "GATE_ALLOW", refs: { intent_mandate_id: "im_2", amount_cents: "5000", quantity: "2" }, reasons: [], timestamp: "2026-10-19T00:00:00Z" }),
    ];
    expect(check({}, other)).toEqual([]);
  });

  it("fails closed when a prior allow clip is missing its amount", () => {
    const chain = [nextClip([], { type: "GATE_ALLOW", refs: { intent_mandate_id: "im_1" }, reasons: [], timestamp: "2026-10-19T00:00:00Z" })];
    expect(check({}, chain)).toEqual(["PERIOD_AMOUNT_OVER_CAP", "PERIOD_QUANTITY_OVER_CAP"]);
  });

  it("reports every violation at once", () => {
    const items = [{ sku: "GOLD-BAR", qty: 5, unit_price: { value: "999.00", currency: "USD" } }];
    expect(check({ merchant: "evil", items, total: { value: "1.00", currency: "USD" } })).toEqual([
      "MERCHANT_NOT_ALLOWED",
      "SKU_NOT_ALLOWED:GOLD-BAR",
      "UNIT_PRICE_OVER_CAP:GOLD-BAR",
      "CART_TOTAL_MISMATCH",
      "PERIOD_QUANTITY_OVER_CAP",
    ]);
  });
});

describe("periodMs", () => {
  it("parses days, weeks and months", () => {
    expect(periodMs("P1D")).toBe(86_400_000);
    expect(periodMs("P2W")).toBe(14 * 86_400_000);
    expect(periodMs("P1M")).toBe(30 * 86_400_000);
  });
  it("throws on anything else", () => {
    expect(() => periodMs("P1Y")).toThrow();
  });
});
