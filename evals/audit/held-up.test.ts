// Audit Oct 25 regression suite (independent review; see docs/decisions/0006-audit-oct25.md).
// Attacks that the engine withstands. Each mutates the hero (SELLER_FAVOR) case the way a dishonest
// merchant could and asserts the suggestion is no longer SELLER_FAVOR. All of these PASS.
import { type CaseBundle, evaluateCase, generateAgentKey, sha256Hex, customId, invoiceId, formatTerms, parseTerms, verifyMandate } from "@readbackhq/core";
import { heroCase, HERO_TOKEN_ID, type HeroCase } from "@readbackhq/core/fixtures";
import { CompactSign, base64url } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

let hero: HeroCase;
beforeAll(async () => { hero = await heroCase(); });
const clone = (): CaseBundle => structuredClone(hero.bundle);
const pu = (b: CaseBundle) => b.order.purchase_units[0]!;
const notSeller = async (b: CaseBundle, failed?: string) => {
  const r = await evaluateCase(b);
  expect(r.classification.suggestion).not.toBe("SELLER_FAVOR");
  if (failed) expect(r.failed).toContain(failed);
  return r;
};
const sign = (payload: object, header: Record<string, unknown>) =>
  new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: "ES256", typ: "rb-mandate+jwt", jwk: hero.agent.publicJwk, ...header } as never).sign(hero.agent.privateKey);

describe("held up", () => {
  it("control: hero is SELLER_FAVOR", async () => {
    expect((await evaluateCase(clone())).classification).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR" });
  });

  it("genuine mandate reused in the next period (relabeled, captured next day)", async () => {
    const b = clone();
    const p = hero.mandate.p + 1;
    pu(b).invoice_id = b.capture.invoice_id = invoiceId(HERO_TOKEN_ID, p);
    pu(b).custom_id = b.capture.custom_id = customId(HERO_TOKEN_ID, hero.termsHash, p, hero.mandateHash);
    b.capture.create_time = "2026-11-09T15:00:00Z";
    await notSeller(b, "3");
  });

  it("genuine mandate captured 10 minutes late (AUTHORIZE, then capture)", async () => {
    const b = clone();
    b.capture.create_time = "2026-11-08T15:10:00Z";
    await notSeller(b, "3");
  });

  it("mandate for another of Maya's agreements, relabeled to this one", async () => {
    const other = await heroCase({ agent: hero.agent, mandate: { agr: "otherTok123" } });
    const b = clone();
    pu(b).items![0]!.description = other.jws;
    await notSeller(b, "3");
  });

  it("order amount raised while the mandate stays", async () => {
    const b = clone();
    pu(b).amount = { currency_code: "USD", value: "65.00", breakdown: { item_total: { currency_code: "USD", value: "65.00" } } };
    b.capture.amount.value = "65.00";
    await notSeller(b, "3");
  });

  it("unit price raised, qty lowered? (qty 1, so unit 129.98 total 129.98)", async () => {
    const b = clone();
    pu(b).items![0]!.unit_amount.value = "129.98";
    pu(b).amount = { currency_code: "USD", value: "129.98", breakdown: { item_total: { currency_code: "USD", value: "129.98" } } };
    b.capture.amount.value = "129.98";
    await notSeller(b, "3");
  });

  it("partial capture smaller than order", async () => {
    const b = clone();
    b.capture.amount.value = "30.00";
    await notSeller(b, "5");
  });

  it("shipping/tax added in breakdown", async () => {
    const b = clone();
    pu(b).amount.breakdown!.shipping = { currency_code: "USD", value: "5.00" };
    await notSeller(b, "5");
  });

  it("second item slipped into the purchase unit", async () => {
    const b = clone();
    pu(b).items!.push({ name: "Extra", sku: "GBP-SR24", quantity: "1", unit_amount: { currency_code: "USD", value: "0.00" } });
    await notSeller(b, "6");
  });

  it("quantity written as '01'", async () => {
    const b = clone();
    pu(b).items![0]!.quantity = "01";
    await notSeller(b, "3");
  });

  it("amount strings in non-canonical form (64.990)", async () => {
    const b = clone();
    pu(b).amount.value = "64.990";
    await notSeller(b);
  });

  it("custom_id termsHash16 names other terms", async () => {
    const b = clone();
    pu(b).custom_id = b.capture.custom_id = customId(HERO_TOKEN_ID, "f".repeat(64), hero.mandate.p, hero.mandateHash);
    await notSeller(b, "9");
  });

  it("invoice and custom_id periods disagree", async () => {
    const b = clone();
    pu(b).invoice_id = b.capture.invoice_id = invoiceId(HERO_TOKEN_ID, hero.mandate.p + 1);
    await notSeller(b, "2b");
  });

  it("capture labels differ from order labels", async () => {
    const b = clone();
    b.capture.custom_id = customId(HERO_TOKEN_ID, hero.termsHash, hero.mandate.p, "0".repeat(64));
    await notSeller(b, "2b");
  });

  it("merchant's own key signs; token terms name Maya's key", async () => {
    const forged = await heroCase({ agent: hero.agent, signer: await generateAgentKey(true) });
    await notSeller(forged.bundle, "3");
  });

  it("merchant copies terms with ITS key onto the order; token keeps Maya's (audit finding 1 fix)", async () => {
    const mk = await generateAgentKey(true);
    const forged = await heroCase({ agent: mk });
    const b = forged.bundle;
    b.token = hero.bundle.token; // PayPal's token still carries Maya's terms
    await notSeller(b, "3");
  });

  it("token exists but carries no terms; order carries merchant's copy", async () => {
    const b = clone();
    delete b.token!.payment_source.paypal.description;
    const r = await notSeller(b, "1");
    expect(r.classification.suggestion).toBeNull();
  });

  it("labels name another payer's agreement (accepted: no suggestion either way)", async () => {
    const b = clone();
    b.token!.payment_source.paypal.payer_id = "SOMEONE_ELSE";
    const r = await notSeller(b, "1");
    expect(r.classification).toMatchObject({ row: 1, suggestion: null });
  });

  it("order payer differs from token payer", async () => {
    const b = clone();
    b.order.payer = { payer_id: "OTHER" };
    b.order.payment_source!.paypal!.account_id = "OTHER";
    await notSeller(b, "1");
  });

  it("capture PENDING without a dispute hold", async () => {
    const b = clone();
    b.capture.status = "PENDING";
    await notSeller(b, "4");
  });

  it("PayPal echoes a different vault id than the labels", async () => {
    const b = clone();
    b.order.payment_source!.paypal!.attributes = { vault: { id: "someOtherToken" } };
    await notSeller(b);
  });

  it("history incomplete (search failed) withholds seller favor", async () => {
    const b = clone();
    b.historyComplete = false;
    const r = await notSeller(b);
    expect(r.classification.suggestion).toBeNull();
  });

  describe("JWS header tricks (all rejected)", () => {
    it.each([
      ["kid", { kid: "x" }],
      ["cty", { cty: "json" }],
      ["jku", { jku: "https://evil.example/jwks" }],
      ["typ JWT", { typ: "JWT" }],
      ["jwk with d", { jwk: { ...hero?.agent?.publicJwk, d: "A".repeat(43) } }],
      ["jwk with kid", { jwk: { ...hero?.agent?.publicJwk, kid: "a" } }],
    ])("%s", async (_name, header) => {
      const h = "jwk" in header && typeof header.jwk === "object" ? { ...header, jwk: { ...hero.agent.publicJwk, ...(header.jwk as object) } } : header;
      const jws = await sign(hero.mandate, h);
      expect((await verifyMandate(jws)).ok).toBe(false);
    });

    it("crit header, hand-signed with the real key", async () => {
      const h = base64url.encode(JSON.stringify({ alg: "ES256", typ: "rb-mandate+jwt", jwk: hero.agent.publicJwk, crit: ["exp"], exp: 1 }));
      const p = base64url.encode(JSON.stringify(hero.mandate));
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, hero.agent.privateKey as globalThis.CryptoKey, new TextEncoder().encode(`${h}.${p}`));
      expect((await verifyMandate(`${h}.${p}.${base64url.encode(new Uint8Array(sig))}`)).ok).toBe(false);
    });

    it("alg=none / unsigned", async () => {
      const h = base64url.encode(JSON.stringify({ alg: "none", typ: "rb-mandate+jwt", jwk: hero.agent.publicJwk }));
      const p = base64url.encode(JSON.stringify(hero.mandate));
      expect((await verifyMandate(`${h}.${p}.`)).ok).toBe(false);
      expect((await verifyMandate(`${h}.${p}.AAAA`)).ok).toBe(false);
    });

    it("payload with extra field or wrong total is refused", async () => {
      expect((await verifyMandate(await sign({ ...hero.mandate, note: "x" }, {}))).ok).toBe(false);
      expect((await verifyMandate(await sign({ ...hero.mandate, amt: "129.98" }, {}))).ok).toBe(false);
    });

    it("jwk x re-encoded with non-canonical trailing bits: fingerprint changes (hurts merchant, not helps)", async () => {
      const x = hero.agent.publicJwk.x;
      const last = x[42]!;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const alt = alphabet[(alphabet.indexOf(last) ^ 1)]!; // flip a padding bit
      const jws = await sign(hero.mandate, { jwk: { ...hero.agent.publicJwk, x: x.slice(0, 42) + alt } });
      const v = await verifyMandate(jws);
      // Observed: jose decodes the non-canonical coordinate to the same key bytes, so the signature
      // VERIFIES, but RFC 7638 hashes the x string as given, so the fingerprint no longer matches the
      // approved one → KEY_NOT_APPROVED in check 3. Merchant-unfavorable; the approved fingerprint
      // can't be reached from any other encoding without the private key.
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.value.fingerprint).not.toBe(hero.agent.fingerprint);
    });
  });

  describe("terms canonical form", () => {
    it.each([
      hero?.termsText,
    ])("control parses", () => { expect(parseTerms(formatTerms(hero.terms)).ok).toBe(true); });
    it.each([
      (t: string) => t.replace("Good Boy", "Good  Boy"),
      (t: string) => t.replace("Good Boy", "Good Boy"),
      (t: string) => t.replace("65.00", "065.00"),
      (t: string) => t.replace("65.00", "65.0"),
      (t: string) => t.replace("GBP-SR24", "gbp-sr24"),
      (t: string) => `${t} `,
      (t: string) => t.replace("x1/1d", "x1/01d"),
      (t: string) => t.replace("2027-03-31", "2027-02-30"),
      (t: string) => t.replace("agent ", "agent  "),
    ])("variant %#", (mut) => {
      expect(parseTerms(mut(formatTerms(hero.terms))).ok).toBe(false);
    });
  });

  it("periodDays=30: mandate labeled for the period after the one it was signed in", async () => {
    const h = await heroCase({ agent: hero.agent, periodDays: 30 });
    const b = h.bundle;
    const p = h.mandate.p + 1;
    pu(b).invoice_id = b.capture.invoice_id = invoiceId(HERO_TOKEN_ID, p);
    pu(b).custom_id = b.capture.custom_id = customId(HERO_TOKEN_ID, h.termsHash, p, h.mandateHash);
    await notSeller(b, "3");
  });

  it("unsigned direct charge with Maya's wallet (the twist) → BUYER_FAVOR", async () => {
    const b = clone();
    delete pu(b).items![0]!.description;
    expect((await evaluateCase(b)).classification).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
  });

  it("direct charge labeled with a nonexistent agreement (token 404, merchant terms copy) → BUYER_FAVOR", async () => {
    const b = clone();
    delete pu(b).items![0]!.description;
    b.token = null;
    expect((await evaluateCase(b)).classification).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
  });

  it("mandateHash16 in custom_id is not the real one", async () => {
    const b = clone();
    pu(b).custom_id = b.capture.custom_id = customId(HERO_TOKEN_ID, hero.termsHash, hero.mandate.p, await sha256Hex("other"));
    await notSeller(b, "2b");
  });
});
