// Mandates travel as W3C Verifiable Credentials encoded as VC-JWT, signed with Ed25519.
import { type CryptoKey, decodeJwt, jwtVerify, SignJWT } from "jose";
import type { z } from "zod";
import { publicKeyFromDid } from "./did.ts";

export type CredentialType = "IntentMandate" | "CartMandate" | "PaymentMandate";

export type SignInput = {
  type: CredentialType;
  subject: object; // the mandate itself
  id: string;
  issuer: string; // signer DID
  holder?: string; // e.g. the agent DID for an IntentMandate
  privateKey: CryptoKey;
  validFrom: string; // ISO datetime
  expiresAt: string;
};

const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export async function signCredential(input: SignInput): Promise<string> {
  const jwt = new SignJWT({
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", input.type],
      credentialSubject: input.subject,
    },
  })
    .setProtectedHeader({ alg: "EdDSA", kid: `${input.issuer}#${input.issuer.slice("did:key:".length)}` })
    .setIssuer(input.issuer)
    .setJti(input.id)
    .setNotBefore(seconds(input.validFrom))
    .setExpirationTime(seconds(input.expiresAt));
  if (input.holder) jwt.setSubject(input.holder);
  return jwt.sign(input.privateKey);
}

export type VerifyResult<T> = { ok: true; subject: T; issuer: string } | { ok: false; reason: string };

// Generic over T: pass IntentMandateSchema, get back a typed IntentMandate.
// Never throws: every failure (bad signature, wrong issuer, expired, bad shape) is { ok: false }.
export async function verifyCredential<T>(
  jwt: string,
  schema: z.ZodType<T>,
  opts: { type: CredentialType; expectedIssuer: string; now: Date },
): Promise<VerifyResult<T>> {
  try {
    const claimedIssuer = decodeJwt(jwt).iss; // unverified: only used to pick the key
    if (claimedIssuer !== opts.expectedIssuer) return { ok: false, reason: "unexpected issuer" };
    const key = await publicKeyFromDid(claimedIssuer);
    const { payload } = await jwtVerify(jwt, key, {
      algorithms: ["EdDSA", "Ed25519"],
      issuer: opts.expectedIssuer,
      currentDate: opts.now,
    });
    const vc = payload["vc"];
    if (typeof vc !== "object" || vc === null) return { ok: false, reason: "missing vc claim" };
    const { type, credentialSubject } = vc as { type?: unknown; credentialSubject?: unknown };
    if (!Array.isArray(type) || !type.includes(opts.type)) return { ok: false, reason: "wrong credential type" };
    const parsed = schema.safeParse(credentialSubject);
    if (!parsed.success) return { ok: false, reason: "invalid credential subject" };
    return { ok: true, subject: parsed.data, issuer: claimedIssuer };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "verification failed" };
  }
}
