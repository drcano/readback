import { type AgentKey, formatTerms, generateAgentKey, type Terms, verifyMandate } from "@readbackhq/core";
import { exportJWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { loadAgentKey } from "./key.ts";
import { signReorder } from "./sign.ts";

let key: AgentKey;
let envValue: string;
let terms: Terms;
const NOW = Date.parse("2026-11-08T15:00:00Z") / 1000;

beforeAll(async () => {
  const generated = await generateAgentKey(true);
  envValue = JSON.stringify(await exportJWK(generated.privateKey));
  key = await loadAgentKey(envValue);
  terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: key.fingerprint };
});

describe("loadAgentKey", () => {
  it("loads a P-256 private JWK and derives the public key and fingerprint", async () => {
    expect(key.fingerprint).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(key.publicJwk).not.toHaveProperty("d");
  });

  it("refuses missing, non-JSON, or wrong-curve keys without echoing the value", async () => {
    await expect(loadAgentKey(undefined)).rejects.toThrow(/not set/);
    await expect(loadAgentKey("SECRET-not-json")).rejects.toThrow("AGENT_PRIVATE_KEY is not valid JSON.");
    await expect(loadAgentKey(JSON.stringify({ kty: "EC", crv: "P-384", x: "a", y: "b", d: "c" }))).rejects.toThrow(/P-256/);
    const { d: _d, ...publicOnly } = JSON.parse(envValue) as Record<string, string>;
    await expect(loadAgentKey(JSON.stringify(publicOnly))).rejects.toThrow(/P-256 private/);
  });
});

describe("signReorder", () => {
  const req = () => ({ agreement: "8kd73hs9ab", terms: formatTerms(terms), sku: "GBP-SR24", qty: 1, unitCents: 6499 });

  it("signs an in-terms reorder that verifies with its own fingerprint", async () => {
    const r = await signReorder(key, req(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = await verifyMandate(r.value.jws);
    expect(v.ok && v.value.fingerprint).toBe(key.fingerprint);
    expect(v.ok && v.value.payload).toMatchObject({ agr: "8kd73hs9ab", sku: "GBP-SR24", amt: "64.99", p: 19 });
  });

  it("refuses terms that carry someone else's fingerprint (key swap at setup, T21)", async () => {
    const swapped = formatTerms({ ...terms, fingerprint: "AAAAAAAAAAAAAAAA" });
    expect(await signReorder(key, { ...req(), terms: swapped }, NOW)).toMatchObject({ ok: false, error: { code: "NOT_MY_AGREEMENT" } });
  });

  it("refuses to sign outside the terms (prompt-injected 'premium bundle', price swap)", async () => {
    expect(await signReorder(key, { ...req(), sku: "GBP-PREMIUM" }, NOW)).toMatchObject({ ok: false, error: { code: "SKU_NOT_APPROVED" } });
    expect(await signReorder(key, { ...req(), unitCents: 9999 }, NOW)).toMatchObject({ ok: false, error: { code: "OVER_CAP" } });
    expect(await signReorder(key, { ...req(), qty: 3 }, NOW)).toMatchObject({ ok: false, error: { code: "QTY_OVER_LIMIT" } });
  });

  it("refuses unreadable terms", async () => {
    expect(await signReorder(key, { ...req(), terms: "hello" }, NOW)).toMatchObject({ ok: false, error: { code: "TERMS_MALFORMED" } });
  });
});
