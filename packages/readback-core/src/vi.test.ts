import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { VI_DEMO_ISSUER_JWK, VI_EXAMPLE_CHAIN } from "./vi-example.ts";
import { evaluateViChain, type ViChain } from "./vi.ts";

const ISSUER = { jwk: VI_DEMO_ISSUER_JWK, label: "VI's demo issuer key" };
const status = (r: Awaited<ReturnType<typeof evaluateViChain>>, item: string) => r.findings.find((f) => f.item.startsWith(item))?.status;

// Rewrite the L3a payment disclosure (the agent's signed payment) without re-signing.
function tamperPayment(edit: (p: { payee: { id: string }; payment_amount: { amount: number } }) => void): ViChain {
  const parts = VI_EXAMPLE_CHAIN.l3a.split("~");
  const i = parts.findIndex((p) => p && !p.includes(".") && new TextDecoder().decode(base64url.decode(p)).includes("mandate.payment.1"));
  const disc = JSON.parse(new TextDecoder().decode(base64url.decode(parts[i]!))) as [string, Parameters<typeof edit>[0]];
  edit(disc[1]);
  parts[i] = base64url.encode(JSON.stringify(disc));
  return { ...VI_EXAMPLE_CHAIN, l3a: parts.join("~") };
}

describe("Verifiable Intent import: VI's own autonomous example", () => {
  it("verifies all three signatures and both bindings, checks amount, payee and instrument, and is honest about the rest", async () => {
    const r = await evaluateViChain(VI_EXAMPLE_CHAIN, ISSUER);
    for (const item of ["Issuer's signature", "User's signature", "Mandate bound", "Agent's signature", "Payment bound", "Signed while", "Payment instrument", "Amount within range", "Payee allowed"]) {
      expect([item, status(r, item)]).toEqual([item, "pass"]);
    }
    expect(status(r, "Reference")).toBe("unresolved");
    expect(status(r, "Constraint mandate.payment.recurrence")).toBe("unresolved");
    expect(r.verdict).toBe("unresolved"); // never "allow" while something couldn't be checked
    expect(r.purchase).toEqual({ payeeId: "merchant-uuid-1", amountCents: 27999, currency: "USD" });
    expect(r.mapped.merchant).toBe("Tennis Warehouse");
    expect(r.mapped.capCents).toBe(40000);
    expect(r.mapped.fingerprint).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("without an issuer key, the issuer signature is unresolved, not passed", async () => {
    expect(status(await evaluateViChain(VI_EXAMPLE_CHAIN), "Issuer's signature")).toBe("unresolved");
  });

  it("the wrong issuer key: denied", async () => {
    const wrong = { ...ISSUER, jwk: { ...VI_DEMO_ISSUER_JWK, x: VI_DEMO_ISSUER_JWK.y, y: VI_DEMO_ISSUER_JWK.x } };
    expect((await evaluateViChain(VI_EXAMPLE_CHAIN, wrong)).verdict).toBe("deny");
  });

  it("a flipped character in the agent's signature: denied", async () => {
    const [jws, ...rest] = VI_EXAMPLE_CHAIN.l3a.split("~");
    const bad = jws!.slice(0, -2) + (jws!.endsWith("AA") ? "BB" : "AA");
    const r = await evaluateViChain({ ...VI_EXAMPLE_CHAIN, l3a: [bad, ...rest].join("~") }, ISSUER);
    expect(status(r, "Agent's signature")).toBe("fail");
    expect(r.verdict).toBe("deny");
  });

  it("an amount raised after signing no longer matches its digest: denied", async () => {
    const r = await evaluateViChain(tamperPayment((p) => { p.payment_amount.amount = 40001; }), ISSUER);
    expect(r.verdict).toBe("deny");
  });

  it("the payee swapped to the allowed payee this party can't see: denied, not crashed", async () => {
    const r = await evaluateViChain(tamperPayment((p) => { p.payee.id = "merchant-uuid-2"; }), ISSUER);
    expect(r.verdict).toBe("deny");
  });

  it("the merchant disclosure dropped from L2: the payment no longer binds", async () => {
    const parts = VI_EXAMPLE_CHAIN.l2.split("~");
    const l2 = [parts[0], parts[1], ""].join("~");
    const r = await evaluateViChain({ ...VI_EXAMPLE_CHAIN, l2 }, ISSUER);
    expect(status(r, "Payment bound")).toBe("fail");
    expect(status(r, "Payee allowed")).toBe("unresolved");
    expect(r.verdict).toBe("deny");
  });

  it("L3a and L1 swapped: denied, not thrown", async () => {
    expect((await evaluateViChain({ l1: VI_EXAMPLE_CHAIN.l3a, l2: VI_EXAMPLE_CHAIN.l2, l3a: VI_EXAMPLE_CHAIN.l1 }, ISSUER)).verdict).toBe("deny");
  });

  it("garbage is denied, not thrown", async () => {
    for (const bad of [{ l1: "", l2: "", l3a: "" }, { ...VI_EXAMPLE_CHAIN, l2: "not a credential" }]) {
      expect((await evaluateViChain(bad, ISSUER)).verdict).toBe("deny");
    }
  });
});
