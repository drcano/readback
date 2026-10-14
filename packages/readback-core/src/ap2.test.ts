import { base64url, CompactSign, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { AP2_EXAMPLE_CHAIN } from "./ap2-example.ts";
import { evaluateAp2Chain } from "./ap2.ts";
import { generateAgentKey } from "./thumbprint.ts";

const status = (r: Awaited<ReturnType<typeof evaluateAp2Chain>>, item: string) => r.findings.find((f) => f.item.startsWith(item))?.status;

describe("AP2 import: the official v0.2.0 example", () => {
  it("verifies the agent signature and binding, checks amount and payee, and is honest about the rest", async () => {
    const r = await evaluateAp2Chain(AP2_EXAMPLE_CHAIN);
    expect(status(r, "Agent's signature")).toBe("pass");
    expect(status(r, "Closed mandate bound")).toBe("pass");
    expect(status(r, "Amount within range")).toBe("pass"); // USD 199.00 under a USD 200.00 cap
    expect(status(r, "Payee allowed")).toBe("pass");
    expect(status(r, "Signed while")).toBe("pass");
    expect(status(r, "Reference")).toBe("unresolved");
    expect(status(r, "Issuer signature")).toBe("unresolved");
    expect(r.verdict).toBe("unresolved"); // never "allow" while something couldn't be checked
    expect(r.mapped).toEqual({ merchant: "Demo Merchant", capCents: 20000, fingerprint: "qoF1ZXagbdW0cA0F", notApplicable: ["SKU", "quantity per order"] });
    expect(r.purchase).toEqual({ payeeId: "merchant_1", amountCents: 19900, currency: "USD" });
  });

  it("a tampered closed-mandate amount no longer matches its digest: denied", async () => {
    const [open, closed] = AP2_EXAMPLE_CHAIN.split("~~") as [string, string];
    const parts = closed.split("~");
    const disc = JSON.parse(new TextDecoder().decode(base64url.decode(parts[1]!))) as [string, { payment_amount: { amount: number } }];
    disc[1].payment_amount.amount = 1;
    parts[1] = base64url.encode(JSON.stringify(disc));
    expect((await evaluateAp2Chain(`${open}~~${parts.join("~")}`)).verdict).toBe("deny");
  });

  it("a flipped character in the agent's signature: denied", async () => {
    const [open, closed] = AP2_EXAMPLE_CHAIN.split("~~") as [string, string];
    const [jws, ...rest] = closed.split("~");
    const bad = jws!.slice(0, -2) + (jws!.endsWith("AA") ? "BB" : "AA");
    expect((await evaluateAp2Chain(`${open}~~${[bad, ...rest].join("~")}`)).verdict).toBe("deny");
  });

  it("garbage is denied, not thrown", async () => {
    for (const bad of ["", "not a chain", "a~~b", `${AP2_EXAMPLE_CHAIN}~~extra`]) {
      expect((await evaluateAp2Chain(bad)).verdict).toBe("deny");
    }
  });
});

// A minimal SD-JWT chain builder, to test outcomes the official example doesn't cover.
async function chain(opts: { maxCents: number; amountCents: number; payeeId: string; extra?: object[]; signer?: "agent" | "other"; leakPrivate?: boolean; hideProps?: boolean }) {
  const agent = await generateAgentKey(true);
  const other = await generateAgentKey(true);
  const issuer = await generateKeyPair("ES256");
  const enc = (v: unknown) => base64url.encode(JSON.stringify(v));
  const dig = async (s: string) => base64url.encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
  const sign = async (header: object, payload: object, key: CryptoKey) => new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader(header as { alg: string }).sign(key);

  const payeeDisc = enc(["salt1", { id: "merchant_1", name: "Good Boy Provisions" }]);
  const openMandate = {
    vct: "mandate.payment.open.1",
    constraints: [
      { type: "payment.amount_range", currency: "USD", max: opts.maxCents, min: 0 },
      { type: "payment.allowed_payees", allowed: [{ "...": await dig(payeeDisc) }] },
      ...(opts.extra ?? []),
    ],
    cnf: { jwk: opts.leakPrivate ? { ...agent.publicJwk, d: "A".repeat(43) } : agent.publicJwk },
    ...(opts.hideProps ? { _sd: ["somedigest"] } : {}),
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  };
  const openDisc = enc(["salt2", openMandate]);
  const issuerJwt = await sign({ alg: "ES256", typ: "example+sd-jwt", kid: "test-issuer" }, { delegate_payload: [{ "...": await dig(openDisc) }], _sd_alg: "sha-256" }, issuer.privateKey);
  const openToken = `${issuerJwt}~${payeeDisc}~${openDisc}~`;
  const closedDisc = enc(["salt3", { vct: "mandate.payment.1", transaction_id: "t1", payee: { id: opts.payeeId, name: "x" }, payment_amount: { amount: opts.amountCents, currency: "USD" } }]);
  const kb = await sign({ alg: "ES256", typ: "kb+sd-jwt" }, { delegate_payload: [{ "...": await dig(closedDisc) }], iat: 1_800_000_100, sd_hash: await dig(openToken), _sd_alg: "sha-256" }, (opts.signer === "other" ? other : agent).privateKey);
  return `${openToken}~${kb}~${closedDisc}~`;
}

describe("AP2 import: constructed chains", () => {
  it("in range, allowed payee, every constraint evaluable → only the issuer stays unresolved", async () => {
    const r = await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 6499, payeeId: "merchant_1" }));
    expect(r.findings.filter((f) => f.status !== "pass").map((f) => f.item)).toEqual(["Issuer signature on the open mandate"]);
  });
  it("over the range → deny", async () => {
    expect((await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 6501, payeeId: "merchant_1" }))).verdict).toBe("deny");
  });
  it("payee not allowed → deny", async () => {
    expect((await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "petmegamart" }))).verdict).toBe("deny");
  });
  it("closed mandate signed by a different key → deny", async () => {
    const r = await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", signer: "other" }));
    expect(status(r, "Agent's signature")).toBe("fail");
  });
  it("unknown constraint → deny (AP2: unresolved_constraint fails)", async () => {
    expect((await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", extra: [{ type: "payment.mystery" }] }))).verdict).toBe("deny");
  });
  it("agent_recurrence → unresolved (needs memory of earlier uses)", async () => {
    const r = await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", extra: [{ type: "payment.agent_recurrence", frequency: "MONTHLY" }] }));
    expect(status(r, "Constraint payment.agent_recurrence")).toBe("unresolved");
  });

  it("execution dates: inside → pass, outside → deny", async () => {
    const inside = [{ type: "payment.execution_date", not_before: "2027-01-01T00:00:00Z", not_after: "2027-12-31T00:00:00Z" }];
    const outside = [{ type: "payment.execution_date", not_before: "2028-01-01T00:00:00Z" }];
    expect(status(await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", extra: inside })), "Within the execution dates")).toBe("pass");
    expect((await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", extra: outside }))).verdict).toBe("deny");
  });
  it("instrument limits → unresolved", async () => {
    const r = await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", extra: [{ type: "payment.allowed_payment_instruments" }] }));
    expect(r.verdict).toBe("unresolved");
  });
  it("fails closed on a cnf carrying a private key, or on hidden properties", async () => {
    expect((await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", leakPrivate: true }))).verdict).toBe("deny");
    const hidden = await evaluateAp2Chain(await chain({ maxCents: 6500, amountCents: 100, payeeId: "merchant_1", hideProps: true }));
    expect(hidden.verdict).toBe("deny");
    expect(hidden.findings.at(-1)?.detail).toMatch(/Hidden content/);
  });
});
