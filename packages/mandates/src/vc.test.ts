import { SignJWT, UnsecuredJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { generateDidKey, type KeyPair, publicKeyFromDid } from "./did.ts";
import { IntentMandateSchema } from "./schemas.ts";
import { intentMandate, NOW } from "./test-fixtures.ts";
import { signCredential, verifyCredential } from "./vc.ts";

let shopper: KeyPair;
let attacker: KeyPair;
let agentDid: string;

beforeAll(async () => {
  shopper = await generateDidKey();
  attacker = await generateDidKey();
  agentDid = (await generateDidKey()).did;
});

function sign(signer: KeyPair, subject: object = intentMandate(shopper.did, agentDid)) {
  return signCredential({
    type: "IntentMandate",
    subject,
    id: "im_1",
    issuer: signer.did,
    holder: agentDid,
    privateKey: signer.privateKey,
    validFrom: "2026-10-14T00:00:00Z",
    expiresAt: "2027-10-14T00:00:00Z",
  });
}

const opts = () => ({ type: "IntentMandate" as const, expectedIssuer: shopper.did, now: NOW });

describe("did:key", () => {
  it("produces Ed25519 did:keys that round-trip to a public key", async () => {
    expect(shopper.did).toMatch(/^did:key:z6Mk/);
    await expect(publicKeyFromDid(shopper.did)).resolves.toBeDefined();
  });
  it("is browser-safe: imports only jose", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./did.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Buffer|node:/);
  });
  it("rejects non-Ed25519 or malformed DIDs", async () => {
    await expect(publicKeyFromDid("did:web:example.com")).rejects.toThrow();
    await expect(publicKeyFromDid("did:key:z0OIl")).rejects.toThrow("invalid base58");
    await expect(publicKeyFromDid("did:key:z1111")).rejects.toThrow("not an Ed25519");
  });
});

describe("verifyCredential", () => {
  it("accepts a valid signed mandate and returns it typed", async () => {
    const result = await verifyCredential(await sign(shopper), IntentMandateSchema, opts());
    expect(result).toMatchObject({ ok: true, issuer: shopper.did });
    if (result.ok) expect(result.subject.shopping_intent.skus).toEqual(["COFFEE-1KG"]);
  });

  it("rejects a mandate signed by someone else", async () => {
    const result = await verifyCredential(await sign(attacker), IntentMandateSchema, opts());
    expect(result).toEqual({ ok: false, reason: "unexpected issuer" });
  });

  it("rejects a forged iss (attacker key, shopper DID)", async () => {
    const forged = await new SignJWT({ vc: { type: ["IntentMandate"], credentialSubject: {} } })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer(shopper.did)
      .sign(attacker.privateKey);
    expect((await verifyCredential(forged, IntentMandateSchema, opts())).ok).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await sign(shopper)).split(".");
    const evil = intentMandate(shopper.did, agentDid);
    evil.shopping_intent.max_unit_price.value = "9999.00";
    const payload = Buffer.from(
      JSON.stringify({ iss: shopper.did, vc: { type: ["VerifiableCredential", "IntentMandate"], credentialSubject: evil } }),
    ).toString("base64url");
    expect((await verifyCredential(`${h}.${payload}.${s}`, IntentMandateSchema, opts())).ok).toBe(false);
  });

  it("rejects alg=none", async () => {
    const unsigned = new UnsecuredJWT({ vc: {} }).setIssuer(shopper.did).encode();
    expect((await verifyCredential(unsigned, IntentMandateSchema, opts())).ok).toBe(false);
  });

  it("rejects expired and not-yet-valid credentials", async () => {
    const jwt = await sign(shopper);
    const late = await verifyCredential(jwt, IntentMandateSchema, { ...opts(), now: new Date("2028-01-01T00:00:00Z") });
    const early = await verifyCredential(jwt, IntentMandateSchema, { ...opts(), now: new Date("2026-01-01T00:00:00Z") });
    expect(late.ok).toBe(false);
    expect(early.ok).toBe(false);
  });

  it("rejects the wrong credential type", async () => {
    const result = await verifyCredential(await sign(shopper), IntentMandateSchema, { ...opts(), type: "CartMandate" });
    expect(result).toEqual({ ok: false, reason: "wrong credential type" });
  });

  it("rejects a subject that fails the schema (unknown field)", async () => {
    const jwt = await sign(shopper, { ...intentMandate(shopper.did, agentDid), sneaky: true });
    expect(await verifyCredential(jwt, IntentMandateSchema, opts())).toEqual({ ok: false, reason: "invalid credential subject" });
  });

  it("rejects a JWT with no vc claim", async () => {
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA" }).setIssuer(shopper.did).sign(shopper.privateKey);
    expect(await verifyCredential(jwt, IntentMandateSchema, opts())).toEqual({ ok: false, reason: "missing vc claim" });
  });

  it("rejects garbage", async () => {
    expect((await verifyCredential("not.a.jwt", IntentMandateSchema, opts())).ok).toBe(false);
  });
});
