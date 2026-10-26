// Audit Oct 25 regression suite (independent review; see docs/decisions/0006-audit-oct25.md).
// Things that were attacked and held. Every test here is expected to PASS.
import {
  authorizeCharge,
  buildMandate,
  type CaseBundle,
  checkFreshness,
  evaluateCase,
  formatTerms,
  MandatePayloadSchema,
  parseCents,
  parseTerms,
  signActionProof,
  signJws,
  signMandate,
  verifyActionProof,
  verifyMandate,
} from "@readback/core";
import { heroCase, type HeroCase } from "@readback/core/fixtures";
import { paypalClient } from "@readback/verify";
import { fakePayPal } from "@readback/verify/fake";
import { base64url } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { checkout } from "../../apps/web/lib/checkout.ts";

let hero: HeroCase;
beforeAll(async () => {
  hero = await heroCase();
});
const ENV = { PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" };
const codes = (d: Awaited<ReturnType<typeof authorizeCharge>>) => (d.allow ? "ALLOW" : d.failures.map((f) => f.code));

describe("money", () => {
  it("rejects every non-canonical string", () => {
    for (const s of ["64.990", "6.4999e1", "-0", "-0.00", "065.00", "65", "65.0", " 64.99", "64.99 ", "64,99", "1e2", "0x10", "Infinity", "NaN", "10000.00"]) {
      expect(parseCents(s), s).toBeNull();
    }
    expect(parseCents("0.00")).toBe(0);
    expect(parseCents("9999.99")).toBe(999_999);
  });
  it("a signed mandate with a zero or non-canonical amount is malformed even when signed by the right key", async () => {
    for (const over of [{ unit: "0.00", amt: "0.00" }, { unit: "64.990", amt: "64.990" }, { amt: "64.98" }, { qty: 2 }]) {
      const jws = await signJws({ ...hero.mandate, ...over }, "rb-mandate+jwt", hero.agent.privateKey, hero.agent.publicJwk);
      const v = await verifyMandate(jws);
      expect(v.ok, JSON.stringify(over)).toBe(false);
    }
  });
  it("cap equal to price passes; qty×unit over cap fails; qty over limit fails", async () => {
    const ctx = { tokenId: hero.bundle.token!.id, terms: { ...hero.terms, capCents: 6499 }, termsHash: hero.termsHash };
    expect(buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, ctx, hero.mandate.iat, "jti-cap-00001").ok).toBe(true);
    const over = buildMandate({ sku: "GBP-SR24", qty: 2, unitCents: 6499 }, { ...ctx, terms: { ...hero.terms, qty: 5 } }, hero.mandate.iat, "jti-cap-00002");
    expect(over.ok ? "OK" : over.error.code).toBe("OVER_CAP");
    const qty = buildMandate({ sku: "GBP-SR24", qty: 2, unitCents: 100 }, ctx, hero.mandate.iat, "jti-cap-00003");
    expect(qty.ok ? "OK" : qty.error.code).toBe("QTY_OVER_LIMIT");
  });
});

describe("periods and dates (UTC)", () => {
  it("signed at 23:59:59 on day 1, charged at 00:00:30 on day 2: period 1, canonical invoice, all checks pass", async () => {
    const iat = Date.parse("2026-10-21T23:59:59Z") / 1000;
    const built = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: hero.bundle.token!.id, terms: hero.terms, termsHash: hero.termsHash }, iat, "jti-midnight-01");
    if (!built.ok) throw new Error(built.error.code);
    expect(built.value.p).toBe(1);
    const jws = await signMandate(built.value, hero.agent.privateKey, hero.agent.publicJwk);
    const d = await authorizeCharge({ jws, token: hero.bundle.token, merchant: "Good Boy Provisions", itemName: "x", nowSec: iat + 31 });
    expect(codes(d)).toBe("ALLOW");
    if (!d.allow) return;
    expect(d.invoiceId).toMatch(/-P001$/);
    const b: CaseBundle = structuredClone(hero.bundle);
    const pu = b.order.purchase_units[0]!;
    pu.custom_id = d.customId;
    pu.invoice_id = d.invoiceId;
    pu.items![0]!.description = jws;
    b.capture = { ...b.capture, custom_id: d.customId, invoice_id: d.invoiceId, create_time: "2026-10-22T00:00:30Z" };
    b.history = []; // no priors: only check 11 may fail
    const r = await evaluateCase(b);
    expect(r.failed).toEqual(["11"]);
  });
  it("the gate refuses to charge within 60 s of the end date and before the start", async () => {
    const endEx = Date.parse("2027-04-01T00:00:00Z") / 1000;
    const late = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: hero.bundle.token!.id, terms: hero.terms, termsHash: hero.termsHash }, endEx - 120, "jti-late-00001");
    if (!late.ok) throw new Error(late.error.code);
    const jws = await signMandate(late.value, hero.agent.privateKey, hero.agent.publicJwk);
    expect(codes(await authorizeCharge({ jws, token: hero.bundle.token, merchant: "Good Boy Provisions", itemName: "x", nowSec: endEx - 60 }))).toEqual(["OUTSIDE_DATES"]);
    expect(codes(await authorizeCharge({ jws, token: hero.bundle.token, merchant: "Good Boy Provisions", itemName: "x", nowSec: endEx - 61 }))).toBe("ALLOW");
  });
  it("periodDays > 1: p is derived from iat and must match", async () => {
    const terms = { ...hero.terms, periodDays: 30 };
    const text = formatTerms(terms);
    const th = (await import("@readback/core")).sha256Hex(text);
    const iat = Date.parse("2026-11-20T12:00:00Z") / 1000; // day 30 after Oct 21 start: period 2 begins Nov 20 00:00Z
    const built = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: hero.bundle.token!.id, terms, termsHash: await th }, iat, "jti-p30-000001");
    expect(built.ok && built.value.p).toBe(2);
    const forged = await signJws({ ...(built.ok ? built.value : {}), p: 1 }, "rb-mandate+jwt", hero.agent.privateKey, hero.agent.publicJwk);
    const token = { id: hero.bundle.token!.id, payment_source: { paypal: { description: text, payer_id: "FAKEPAYER0001" } } };
    expect(codes(await authorizeCharge({ jws: forged, token, merchant: "Good Boy Provisions", itemName: "x", nowSec: iat + 1 }))).toEqual(["WRONG_PERIOD"]);
  });
  it("terms at the 125-char worst case parse; 128 chars don't", () => {
    const t = { ...hero.terms, merchant: "Abcdefghij Klmnopqrst Uv", sku: "ABCDEFGHIJKLMNOP", qty: 999, periodDays: 999, capCents: 999_999, start: "2026-10-21", end: "2027-03-31" };
    const text = formatTerms(t);
    expect(text.length).toBeLessThanOrEqual(127);
    expect(parseTerms(text).ok).toBe(true);
    expect(parseTerms(text + " ").ok).toBe(false);
    const long = parseTerms("x".repeat(128));
    expect(long.ok ? "OK" : long.error.code).toBe("TERMS_TOO_LONG");
  });
});

describe("mandate freshness / replay", () => {
  it("exp−iat must be exactly within 300 s; expired and future requests are refused", async () => {
    const long = await signJws({ ...hero.mandate, exp: hero.mandate.iat + 301 }, "rb-mandate+jwt", hero.agent.privateKey, hero.agent.publicJwk);
    expect((await verifyMandate(long)).ok).toBe(false);
    expect(checkFreshness(hero.mandate, hero.mandate.exp + 1).map((f) => f.code)).toEqual(["EXPIRED"]);
    expect(checkFreshness(hero.mandate, hero.mandate.iat - 61).map((f) => f.code)).toEqual(["NOT_YET_VALID"]);
  });
  it("payload with an extra or missing field is refused (strict schema)", () => {
    expect(MandatePayloadSchema.safeParse({ ...hero.mandate, extra: 1 }).success).toBe(false);
    const { jti: _j, ...noJti } = hero.mandate;
    expect(MandatePayloadSchema.safeParse(noJti).success).toBe(false);
  });
  it("the same mandate twice (sequential or concurrent) yields one order; a second mandate in the period is refused by PayPal", async () => {
    const fake = fakePayPal();
    fake.tokens.set(hero.bundle.token!.id, hero.bundle.token as unknown as Record<string, unknown>);
    const pp = paypalClient(ENV, fake.fetch);
    const now = hero.mandate.iat + 5;
    const [a, b, c] = await Promise.all([checkout(hero.jws, pp, now), checkout(hero.jws, pp, now), checkout(hero.jws, pp, now)]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(fake.orders.size).toBe(1);
    const other = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: hero.bundle.token!.id, terms: hero.terms, termsHash: hero.termsHash }, hero.mandate.iat + 1, "jti-second-0001");
    if (!other.ok) throw new Error(other.error.code);
    const r = await checkout(await signMandate(other.value, hero.agent.privateKey, hero.agent.publicJwk), pp, now);
    expect(r.ok ? "OK" : r.failures.map((f) => f.code)).toEqual(["ALREADY_ORDERED_THIS_PERIOD"]);
    expect(fake.orders.size).toBe(1);
  });
});

describe("agreement state and PayPal failures at the gate", () => {
  it("404 token → AGREEMENT_NOT_ACTIVE; 403/500 on the token GET → 502 and nothing charged", async () => {
    const fake = fakePayPal();
    const pp = paypalClient(ENV, fake.fetch);
    const now = hero.mandate.iat + 5;
    const r404 = await checkout(hero.jws, pp, now);
    expect(r404.ok ? "OK" : r404.failures.map((f) => f.code)).toEqual(["AGREEMENT_NOT_ACTIVE"]);
    for (const status of [403, 500]) {
      const broken: typeof fetch = async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/v3/vault/payment-tokens/")) return Response.json({ name: "PERMISSION_DENIED" }, { status });
        return fake.fetch(input, init);
      };
      const r = await checkout(hero.jws, paypalClient(ENV, broken), now);
      expect(r.ok ? "OK" : [r.status, r.failures.map((f) => f.code)]).toEqual([502, ["PAYPAL_UNAVAILABLE"]]);
    }
    expect(fake.posts.length).toBe(0);
  });
  it("a token whose id differs from agr, or whose terms name another key, is refused", async () => {
    const otherTok = { ...hero.bundle.token!, id: "someoneelse" };
    expect(codes(await authorizeCharge({ jws: hero.jws, token: otherTok, merchant: "Good Boy Provisions", itemName: "x", nowSec: hero.mandate.iat + 1 }))).toEqual(["AGREEMENT_NOT_ACTIVE"]);
    const swapped = structuredClone(hero.bundle.token!);
    swapped.payment_source.paypal.description = formatTerms({ ...hero.terms, fingerprint: "AAAAAAAAAAAAAAAA" });
    expect(codes(await authorizeCharge({ jws: hero.jws, token: swapped, merchant: "Good Boy Provisions", itemName: "x", nowSec: hero.mandate.iat + 1 }))).toContain("KEY_NOT_APPROVED");
  });
  it("PayPal declining the create leaves nothing charged and maps to a denial", async () => {
    const fake = fakePayPal();
    fake.tokens.set(hero.bundle.token!.id, hero.bundle.token as unknown as Record<string, unknown>);
    const declining: typeof fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/v2/checkout/orders") && init?.method === "POST") return Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }, { status: 422 });
      return fake.fetch(input, init);
    };
    const r = await checkout(hero.jws, paypalClient(ENV, declining), hero.mandate.iat + 5);
    expect(r.ok ? "OK" : r.failures.map((f) => f.code)).toEqual(["PAYPAL_REFUSED"]);
    expect(fake.orders.size).toBe(0);
  });
});

describe("ECDSA malleability: the twin is the same request at PayPal", () => {
  const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
  const malleate = (jws: string): string => {
    const [h, p, s] = jws.split(".") as [string, string, string];
    const sig = base64url.decode(s);
    const sInt = BigInt("0x" + Buffer.from(sig.slice(32)).toString("hex"));
    const s2 = (N - sInt).toString(16).padStart(64, "0");
    return `${h}.${p}.${base64url.encode(Buffer.concat([Buffer.from(sig.slice(0, 32)), Buffer.from(s2, "hex")]))}`;
  };
  it("the twin verifies with a different mandateHash but the same request ID, so PayPal replays the first order", async () => {
    const twin = malleate(hero.jws);
    expect(twin).not.toBe(hero.jws);
    const [a, b] = [await verifyMandate(hero.jws), await verifyMandate(twin)];
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value.mandateHash).not.toBe(a.value.mandateHash);
    const fake = fakePayPal();
    fake.tokens.set(hero.bundle.token!.id, hero.bundle.token as unknown as Record<string, unknown>);
    const pp = paypalClient(ENV, fake.fetch);
    const now = hero.mandate.iat + 5;
    const first = await checkout(hero.jws, pp, now);
    const second = await checkout(twin, pp, now);
    expect(first.ok && second.ok && first.orderId === second.orderId).toBe(true);
    // Request IDs come from the signed content, so both forms are one request: PayPal replays it,
    // with or without the merchant's duplicate-invoice blocking (audit Oct 25).
    const creates = fake.posts.filter((p) => p.path === "/v2/checkout/orders");
    expect(creates.length).toBe(2);
    expect(creates[0]!.requestId).toBe(creates[1]!.requestId);
    expect(fake.orders.size).toBe(1);
  });
});

describe("known T21: the shopper's agent signs under whatever terms the merchant relays", () => {
  it("relayed terms with a 10x cap and her fingerprint get signed; the gate denies on th", async () => {
    const { signReorder } = await import("../../apps/agent/src/sign.ts");
    const inflated = formatTerms({ ...hero.terms, capCents: 65000 });
    const s = await signReorder(hero.agent, { agreement: hero.bundle.token!.id, terms: inflated, sku: "GBP-SR24", qty: 1, unitCents: 6499 }, hero.mandate.iat);
    expect(s.ok).toBe(true); // the runtime cannot tell relayed terms from PayPal's
    if (!s.ok) return;
    const d = await authorizeCharge({ jws: s.value.jws, token: hero.bundle.token, merchant: "Good Boy Provisions", itemName: "x", nowSec: hero.mandate.iat + 1 });
    expect(d.allow ? "ALLOW" : d.failures.map((f) => f.code)).toEqual(["TERMS_HASH_MISMATCH"]);
  });
});

describe("action proofs", () => {
  it("wrong purpose, wrong token, stale, wrong key are all refused", async () => {
    const now = 1_800_000_000;
    const tok = hero.bundle.token!.id;
    const ok = await signActionProof(tok, "revoke", now, hero.agent.privateKey, hero.agent.publicJwk);
    const exp = { tokenId: tok, purpose: "revoke" as const, termsFingerprint: hero.terms.fingerprint, nowSec: now };
    expect((await verifyActionProof(ok, exp)).ok).toBe(true);
    expect((await verifyActionProof(ok, { ...exp, purpose: "direct-charge" })).ok).toBe(false);
    expect((await verifyActionProof(ok, { ...exp, tokenId: "other" })).ok).toBe(false);
    expect((await verifyActionProof(ok, { ...exp, nowSec: now + 61 })).ok).toBe(false);
    expect((await verifyActionProof(ok, { ...exp, termsFingerprint: "BBBBBBBBBBBBBBBB" })).ok).toBe(false);
    expect((await verifyActionProof(hero.jws, exp)).ok).toBe(false); // a mandate is not an action proof (typ pinned)
  });
});

describe("investigator: lag and partial data never produce BUYER_FAVOR on their own", () => {
  it("incomplete history / fresh capture → provisional → no suggestion, not BUYER_FAVOR", async () => {
    const b = structuredClone(hero.bundle);
    b.historyComplete = false;
    const r = await evaluateCase(b);
    expect(r.classification.suggestion).toBeNull();
    const b2 = structuredClone(hero.bundle);
    b2.history = b2.history.filter((h) => h.captureId === "CAP-HERO");
    const r2 = await evaluateCase(b2);
    expect([r2.classification.row, r2.classification.suggestion]).toEqual([12, null]);
  });
  it("a PARTIALLY_REFUNDED or dispute-held capture still counts as completed", async () => {
    for (const status of ["PARTIALLY_REFUNDED", "REFUNDED"]) {
      const b = structuredClone(hero.bundle);
      b.capture.status = status;
      expect((await evaluateCase(b)).failed).toEqual([]);
    }
    const held = structuredClone(hero.bundle);
    held.capture.status = "PENDING";
    held.capture.status_details = { reason: "BUYER_COMPLAINT" };
    expect((await evaluateCase(held)).failed).toEqual([]);
  });
  it("a capture with an unexpected PayPal shape fails the bundle parse, not the merchant", async () => {
    const { CaseBundleSchema } = await import("@readback/core");
    const b = structuredClone(hero.bundle) as unknown as Record<string, unknown>;
    (b["capture"] as Record<string, unknown>)["amount"] = { currency_code: "USD" }; // value missing
    expect(CaseBundleSchema.safeParse(b).success).toBe(false);
  });
});
