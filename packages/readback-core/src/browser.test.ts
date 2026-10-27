// Runs in headless Chromium (vitest.browser.config.ts). The same code the investigator view uses
// to re-verify a case in the browser: keys, signatures, thumbprints, and the full classification.
import { exportJWK } from "jose";
import { describe, expect, it } from "vitest";
import { evaluateCase } from "./classify.ts";
import { directCharge, heroCase } from "./fixtures.ts";
import { buildMandate, signMandate, verifyMandate } from "./mandate.ts";
import { STORY_TERMS } from "./test-helpers.ts";
import { generateAgentKey } from "./thumbprint.ts";
import { sha256Hex } from "./hash.ts";
import { formatTerms } from "./terms.ts";
import { VI_DEMO_ISSUER_JWK, VI_EXAMPLE_CHAIN } from "./vi-example.ts";
import { evaluateViChain } from "./vi.ts";

describe("readback-core in a real browser", () => {
  it("really is a browser (no Node globals)", () => {
    expect(typeof window).toBe("object");
    expect("process" in globalThis && typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string").toBe(false);
  });

  it("judge mode: a non-extractable tab key signs mandates that verify, and can't be exported", async () => {
    const tab = await generateAgentKey(false);
    const terms = { ...STORY_TERMS, fingerprint: tab.fingerprint };
    const termsHash = await sha256Hex(formatTerms(terms));
    const built = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: "judgeagreement1", terms, termsHash }, Date.parse("2026-11-03T15:00:00Z") / 1000, "jti-browser-01");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const jws = await signMandate(built.value, tab.privateKey, tab.publicJwk);
    const v = await verifyMandate(jws);
    expect(v.ok && v.value.fingerprint).toBe(tab.fingerprint);
    expect(tab.privateKey.extractable).toBe(false);
    await expect(exportJWK(tab.privateKey)).rejects.toThrow();
  });

  it("re-verifies both verdicts in the browser", async () => {
    const hero = await heroCase();
    const t0 = performance.now();
    const seller = await evaluateCase(hero.bundle);
    const buyer = await evaluateCase(directCharge(hero));
    const ms = performance.now() - t0;
    expect(seller.classification).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR" });
    expect(buyer.classification).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
    expect(ms).toBeLessThan(1000);
  });

  it("checks Verifiable Intent's example chain in the browser: three signatures, two bindings", async () => {
    const r = await evaluateViChain(VI_EXAMPLE_CHAIN, { jwk: VI_DEMO_ISSUER_JWK, label: "VI's demo issuer key" });
    expect(r.findings.filter((f) => f.status === "fail")).toEqual([]);
    expect(r.verdict).toBe("unresolved");
  });
});
