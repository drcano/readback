import { base64url, CompactSign, exportJWK } from "jose";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { signActionProof, verifyActionProof } from "./action.ts";
import { sha256Hex } from "./hash.ts";
import { customId, invoiceId, parseCustomId, parseInvoiceId, requestIds } from "./ids.ts";
import { JWS_MAX_LENGTH, signJws, verifyJws } from "./jws.ts";
import {
  buildMandate,
  checkAgainstTerms,
  checkFreshness,
  type MandatePayload,
  signMandate,
  type TermsContext,
  verifyMandate,
} from "./mandate.ts";
import { formatTerms, type Terms } from "./terms.ts";
import { sec, STORY_TERMS } from "./test-helpers.ts";
import { type AgentKey, agentFingerprint, generateAgentKey, groupFingerprint } from "./thumbprint.ts";

const TOKEN = "8kd73hs9ab";
const NOW = sec("2026-11-03T15:00:00Z"); // period 1 of the 30-day story terms
let agent: AgentKey;
let attacker: AgentKey;
let terms: Terms;
let ctx: TermsContext;

beforeAll(async () => {
  agent = await generateAgentKey(true);
  attacker = await generateAgentKey(true);
  terms = { ...STORY_TERMS, fingerprint: agent.fingerprint };
  ctx = { tokenId: TOKEN, terms, termsHash: await sha256Hex(formatTerms(terms)), merchant: "Good Boy Provisions" };
});

const reorder = { sku: "GBP-SR24", qty: 1, unitCents: 6499 };
function payload(over: Partial<MandatePayload> = {}): MandatePayload {
  const built = buildMandate(reorder, ctx, NOW, "jti-0001-abcd");
  if (!built.ok) throw new Error(built.error.code);
  return { ...built.value, ...over };
}

// Swap one base64url part of a compact JWS for new JSON.
function replacePart(jws: string, index: 0 | 1, json: unknown): string {
  const parts = jws.split(".");
  parts[index] = base64url.encode(JSON.stringify(json));
  return parts.join(".");
}
const decodePart = (jws: string, index: 0 | 1): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(base64url.decode(jws.split(".")[index]!)));

describe("fingerprints", () => {
  it("is 16 base64url chars, stable for a key, different across keys", async () => {
    expect(agent.fingerprint).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(await agentFingerprint(agent.publicJwk)).toBe(agent.fingerprint);
    expect(attacker.fingerprint).not.toBe(agent.fingerprint);
  });
  it("groups 4×4 for display, never truncated", () => {
    expect(groupFingerprint("qX7mP2vL9cRt4sYb")).toBe("qX7m P2vL 9cRt 4sYb");
    expect(groupFingerprint("-TJ7jbI7FwjvYh2f")).toBe("-TJ7 jbI7 Fwjv Yh2f"); // a leading "-" stays visible
  });
  it("non-extractable keys can still sign (judge mode)", async () => {
    const tabKey = await generateAgentKey(false);
    const jws = await signMandate(payload(), tabKey.privateKey, tabKey.publicJwk);
    expect((await verifyMandate(jws)).ok).toBe(true);
    await expect(exportJWK(tabKey.privateKey)).rejects.toThrow();
  });
});

describe("closed mandate: sign and verify", () => {
  it("round-trips, reports the signer's fingerprint and the mandateHash", async () => {
    const jws = await signMandate(payload(), agent.privateKey, agent.publicJwk);
    expect(jws.length).toBeLessThan(700); // SPEC §4.3: ~570 typical, 622 worst case
    const v = await verifyMandate(jws);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.fingerprint).toBe(agent.fingerprint);
    expect(v.value.mandateHash).toBe(await sha256Hex(jws));
    expect(checkAgainstTerms(v.value.payload, v.value.fingerprint, ctx)).toEqual([]);
  });

  it("a valid signature from an unapproved key verifies but fails the terms check", async () => {
    const jws = await signMandate(payload(), attacker.privateKey, attacker.publicJwk);
    const v = await verifyMandate(jws);
    expect(v.ok).toBe(true);
    if (v.ok) expect(checkAgainstTerms(v.value.payload, v.value.fingerprint, ctx).map((f) => f.code)).toEqual(["KEY_NOT_APPROVED"]);
  });

  it("refuses a tampered payload", async () => {
    const jws = await signMandate(payload(), agent.privateKey, agent.publicJwk);
    const tampered = replacePart(jws, 1, { ...payload(), unit: "1.00", amt: "1.00" });
    expect(await verifyMandate(tampered)).toMatchObject({ ok: false, error: { code: "SIGNATURE_INVALID" } });
  });

  it("refuses the approved key in the header with an attacker's signature", async () => {
    const jws = await signMandate(payload(), attacker.privateKey, attacker.publicJwk);
    const swapped = replacePart(jws, 0, { alg: "ES256", typ: "rb-mandate+jwt", jwk: agent.publicJwk });
    expect(await verifyMandate(swapped)).toMatchObject({ ok: false, error: { code: "SIGNATURE_INVALID" } });
  });

  const headerAttacks: [string, (h: Record<string, unknown>) => Record<string, unknown>][] = [
    ["alg none", (h) => ({ ...h, alg: "none" })],
    ["alg HS256", (h) => ({ ...h, alg: "HS256" })],
    ["wrong typ", (h) => ({ ...h, typ: "JWT" })],
    ["action typ on a mandate", (h) => ({ ...h, typ: "rb-action+jwt" })],
    ["jku", (h) => ({ ...h, jku: "https://evil.example/keys" })],
    ["x5u", (h) => ({ ...h, x5u: "https://evil.example/cert" })],
    ["kid", (h) => ({ ...h, kid: "1" })],
    ["crit", (h) => ({ ...h, crit: ["b64"], b64: false })],
    ["private key in jwk", (h) => ({ ...h, jwk: { ...(h["jwk"] as object), d: "A".repeat(43) } })],
    ["Ed25519 jwk", (h) => ({ ...h, jwk: { kty: "OKP", crv: "Ed25519", x: "A".repeat(43) } })],
    ["missing jwk", ({ jwk: _jwk, ...h }) => h],
  ];
  it.each(headerAttacks)("refuses header attack: %s", async (_label, mutate) => {
    const jws = await signMandate(payload(), agent.privateKey, agent.publicJwk);
    const evil = replacePart(jws, 0, mutate(decodePart(jws, 0)));
    expect(await verifyMandate(evil)).toMatchObject({ ok: false, error: { code: "JWS_HEADER_REJECTED" } });
  });

  it("refuses a JWS genuinely signed with an extra header member", async () => {
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload())))
      .setProtectedHeader({ alg: "ES256", typ: "rb-mandate+jwt", jwk: agent.publicJwk, kid: "x" })
      .sign(agent.privateKey);
    expect(await verifyMandate(jws)).toMatchObject({ ok: false, error: { code: "JWS_HEADER_REJECTED" } });
  });

  it("refuses malformed or oversized input", async () => {
    for (const bad of ["", "a.b", "a.b.c.d", "a.b.c=", "a b.c.d", "!!.!!.!!", "a".repeat(JWS_MAX_LENGTH) + ".b.c"]) {
      expect((await verifyMandate(bad)).ok, bad).toBe(false);
    }
    expect(await verifyJws("e30.e30.e30", "rb-mandate+jwt")).toMatchObject({ ok: false, error: { code: "JWS_HEADER_REJECTED" } });
    expect(await verifyJws("bm90LWpzb24.e30.e30", "rb-mandate+jwt")).toMatchObject({ ok: false, error: { code: "JWS_MALFORMED" } });
  });

  const payloadAttacks: [string, Record<string, unknown>][] = [
    ["amt ≠ unit × qty", { amt: "1.00" }],
    ["non-canonical amt", { qty: 2, unit: "10.00", amt: "20.0" }],
    ["unit without cents", { unit: "64", amt: "64" }],
    ["exp before iat", { exp: NOW - 1 }],
    ["lifetime > 300s", { exp: NOW + 301 }],
    ["other currency", { cur: "EUR" }],
    ["unknown field", { note: "hi" }],
    ["version 2", { v: 2 }],
    ["qty 0", { qty: 0, amt: "0.00" }],
    ["float qty", { qty: 1.5 }],
  ];
  it.each(payloadAttacks)("refuses a validly signed but bad payload: %s", async (_label, over) => {
    const jws = await signJws({ ...payload(), ...over }, "rb-mandate+jwt", agent.privateKey, agent.publicJwk);
    expect(await verifyMandate(jws)).toMatchObject({ ok: false, error: { code: "MANDATE_MALFORMED" } });
  });

  it("refuses a non-JSON payload", async () => {
    const jws = await new CompactSign(new TextEncoder().encode("not json"))
      .setProtectedHeader({ alg: "ES256", typ: "rb-mandate+jwt", jwk: agent.publicJwk })
      .sign(agent.privateKey);
    expect((await verifyMandate(jws)).ok).toBe(false);
  });

  it("any flipped character in a signed mandate is refused (property)", async () => {
    const jws = await signMandate(payload(), agent.privateKey, agent.publicJwk);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
    await fc.assert(
      fc.asyncProperty(fc.nat(jws.length - 1), fc.constantFrom(...alphabet), async (i, ch) => {
        const mutated = jws.slice(0, i) + ch + jws.slice(i + 1);
        if (mutated === jws) return true;
        const v = await verifyMandate(mutated);
        // Either refused, or (base64url padding bits) it decodes to the very same signed content.
        return !v.ok || (v.value.fingerprint === agent.fingerprint && JSON.stringify(v.value.payload) === JSON.stringify(payload()));
      }),
      { numRuns: 300 },
    );
  });
});

describe("closed mandate: against the terms", () => {
  const codes = (over: Partial<MandatePayload>, c: TermsContext = ctx) =>
    checkAgainstTerms(payload(over), agent.fingerprint, c).map((f) => f.code);

  it("flags each way a request can fall outside the terms", () => {
    expect(codes({ agr: "otheragreement" })).toEqual(["WRONG_AGREEMENT"]);
    expect(codes({ th: "0".repeat(16) })).toEqual(["TERMS_HASH_MISMATCH"]);
    expect(codes({ sku: "GBP-PREMIUM" })).toEqual(["SKU_NOT_APPROVED"]);
    expect(codes({ qty: 2, amt: "129.98" })).toEqual(["QTY_OVER_LIMIT", "OVER_CAP"]);
    expect(codes({ unit: "65.01", amt: "65.01" })).toEqual(["OVER_CAP"]);
    expect(codes({ p: 2 })).toEqual(["WRONG_PERIOD"]);
    expect(codes({ iat: sec("2027-04-01T00:00:00Z") })).toEqual(["OUTSIDE_DATES"]);
    expect(codes({ iat: sec("2026-10-13T23:59:59Z") })).toEqual(["OUTSIDE_DATES"]);
    expect(codes({}, { ...ctx, merchant: "Evil Pets" })).toEqual(["WRONG_MERCHANT"]);
  });

  it("allows exactly the cap", () => {
    expect(codes({ unit: "65.00", amt: "65.00" })).toEqual([]);
  });

  it("freshness: iat up to 60s ahead, refused after exp", () => {
    const m = payload();
    expect(checkFreshness(m, NOW - 60)).toEqual([]);
    expect(checkFreshness(m, NOW - 61).map((f) => f.code)).toEqual(["NOT_YET_VALID"]);
    expect(checkFreshness(m, m.exp)).toEqual([]);
    expect(checkFreshness(m, m.exp + 1).map((f) => f.code)).toEqual(["EXPIRED"]);
  });
});

describe("runtime pre-check (buildMandate)", () => {
  it("builds an in-terms request with the right period", () => {
    expect(payload()).toMatchObject({ p: 1, amt: "64.99", unit: "64.99", exp: NOW + 300, th: ctx.termsHash.slice(0, 16) });
    const later = buildMandate(reorder, ctx, sec("2026-12-20T00:00:00Z"), "jti-0002-abcd");
    expect(later.ok && later.value.p).toBe(3);
  });

  it("refuses to build anything outside the terms (it never signs those)", () => {
    const refuse = (r: typeof reorder, now = NOW) => {
      const b = buildMandate(r, ctx, now, "jti-0003-abcd");
      return b.ok ? "ok" : b.error.code;
    };
    expect(refuse({ ...reorder, sku: "GBP-PREMIUM" })).toBe("SKU_NOT_APPROVED");
    expect(refuse({ ...reorder, qty: 2 })).toBe("QTY_OVER_LIMIT");
    expect(refuse({ ...reorder, unitCents: 6501 })).toBe("OVER_CAP");
    expect(refuse({ ...reorder, unitCents: 0 })).toBe("MANDATE_MALFORMED");
    expect(refuse({ ...reorder, unitCents: 64.5 })).toBe("MANDATE_MALFORMED");
    expect(refuse({ ...reorder, qty: 1000 })).toBe("MANDATE_MALFORMED");
    expect(refuse(reorder, sec("2026-10-01T00:00:00Z"))).toBe("OUTSIDE_DATES");
    expect(refuse(reorder, sec("2027-04-02T00:00:00Z"))).toBe("OUTSIDE_DATES");
  });
});

describe("ids", () => {
  it("formats and parses invoice_id and custom_id (SPEC §4.4)", () => {
    const th = "a".repeat(64);
    const mh = "b".repeat(64);
    expect(invoiceId(TOKEN, 3)).toBe("RB-8kd73hs9ab-P003");
    expect(parseInvoiceId("RB-8kd73hs9ab-P003")).toEqual({ tokenId: TOKEN, period: 3 });
    expect(parseInvoiceId("RB-8k-d7_3-P003")).toEqual({ tokenId: "8k-d7_3", period: 3 });
    const cid = customId(TOKEN, th, 3, mh);
    expect(cid).toBe(`rb1:${TOKEN}:${"a".repeat(16)}:p003:${"b".repeat(16)}`);
    expect(parseCustomId(cid)).toEqual({ tokenId: TOKEN, termsHash16: "a".repeat(16), period: 3, mandateHash16: "b".repeat(16) });
    expect(customId("x".repeat(36), th, 999, mh)).toHaveLength(79); // worst case
  });

  it("refuses non-canonical labels", () => {
    for (const bad of ["RB-8kd73hs9ab-P3", "RB-8kd73hs9ab-P000", "RB-8kd73hs9ab-DIRECT", "rb-8kd73hs9ab-P003", "RB-a:b-P001", `RB-${"x".repeat(37)}-P001`]) {
      expect(parseInvoiceId(bad), bad).toBeNull();
    }
    for (const bad of [`rb1|${TOKEN}|${"a".repeat(16)}|p003|${"b".repeat(16)}`, `rb1:${TOKEN}:${"A".repeat(16)}:p003:${"b".repeat(16)}`, `rb1:${TOKEN}:${"a".repeat(16)}:p000:${"b".repeat(16)}`]) {
      expect(parseCustomId(bad), bad).toBeNull();
    }
  });

  it("derives deterministic request IDs from the mandateHash", () => {
    const ids = requestIds("c".repeat(64));
    expect(ids.create).toBe(`rb-${"c".repeat(40)}`);
    expect(ids.capture).toBe(`rb-${"c".repeat(40)}-capture`);
    expect(ids.track).toBe(`rb-${"c".repeat(40)}-track`);
  });
});

describe("action proofs (SPEC §4.7)", () => {
  const expected = () => ({ tokenId: TOKEN, purpose: "revoke" as const, termsFingerprint: agent.fingerprint, nowSec: NOW });

  it("accepts a fresh proof from the agreement's key", async () => {
    const jws = await signActionProof(TOKEN, "revoke", NOW, agent.privateKey, agent.publicJwk);
    expect(await verifyActionProof(jws, expected())).toEqual({ ok: true, value: { fingerprint: agent.fingerprint } });
  });

  it.each([
    ["wrong key", async () => signActionProof(TOKEN, "revoke", NOW, attacker.privateKey, attacker.publicJwk), "KEY_NOT_APPROVED"],
    ["wrong purpose", async () => signActionProof(TOKEN, "direct-charge", NOW, agent.privateKey, agent.publicJwk), "ACTION_WRONG_PURPOSE"],
    ["stale iat", async () => signActionProof(TOKEN, "revoke", NOW - 61, agent.privateKey, agent.publicJwk), "ACTION_STALE"],
    ["future iat", async () => signActionProof(TOKEN, "revoke", NOW + 61, agent.privateKey, agent.publicJwk), "ACTION_STALE"],
    ["other agreement", async () => signActionProof("otheragreement", "revoke", NOW, agent.privateKey, agent.publicJwk), "WRONG_AGREEMENT"],
    ["extra member", async () => signJws({ tokenId: TOKEN, purpose: "revoke", iat: NOW, x: 1 }, "rb-action+jwt", agent.privateKey, agent.publicJwk), "ACTION_MALFORMED"],
    ["a mandate replayed as a proof", async () => signMandate(payload(), agent.privateKey, agent.publicJwk), "JWS_HEADER_REJECTED"],
  ])("refuses %s", async (_label, make, code) => {
    expect(await verifyActionProof(await make(), expected())).toMatchObject({ ok: false, error: { code } });
  });
});
