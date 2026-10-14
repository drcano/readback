// Compact JWS (RFC 7515) with ES256 over P-256 (RFC 7518), with the hygiene rules of SPEC §4.3.
// A compact JWS is three base64url parts: header.payload.signature. The header carries the
// signer's public key (`jwk`), so anyone can verify; *which* key is acceptable is decided by
// comparing its fingerprint to the approved terms (see thumbprint.ts), never by the header alone.
import { base64url, CompactSign, compactVerify, type CryptoKey, importJWK } from "jose";
import { z } from "zod";
import { fail, ok, type Result } from "./result.ts";

export const JWS_MAX_LENGTH = 2048; // what PayPal retains in items[].description
const COMPACT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const COORD = z.string().regex(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url, no padding

// Exactly these four members. `d` (a private key), `kid`, or anything else is refused.
export const PublicJwkSchema = z.strictObject({ kty: z.literal("EC"), crv: z.literal("P-256"), x: COORD, y: COORD });
export type PublicJwk = z.infer<typeof PublicJwkSchema>;

export type JwsType = "rb-mandate+jwt" | "rb-action+jwt";

// Exactly alg, typ, jwk. This rejects jku/x5u/x5c (fetch-a-key tricks), crit, b64, kid, etc.
const headerSchema = (typ: JwsType) =>
  z.strictObject({ alg: z.literal("ES256"), typ: z.literal(typ), jwk: PublicJwkSchema });

export type VerifiedJws = { payload: unknown; jwk: PublicJwk };

export async function signJws(payload: object, typ: JwsType, privateKey: CryptoKey, jwk: PublicJwk): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "ES256", typ, jwk })
    .sign(privateKey);
}

// Never throws: every problem is a Result failure, so callers can't forget to deny.
export async function verifyJws(jws: string, typ: JwsType): Promise<Result<VerifiedJws>> {
  if (jws.length > JWS_MAX_LENGTH || !COMPACT.test(jws)) {
    return fail("JWS_MALFORMED", "The signed request isn't in the expected format.");
  }
  let rawHeader: unknown;
  try {
    rawHeader = JSON.parse(new TextDecoder().decode(base64url.decode(jws.split(".")[0]!)));
  } catch {
    return fail("JWS_MALFORMED", "The signed request's header can't be read.");
  }
  const header = headerSchema(typ).safeParse(rawHeader);
  if (!header.success) return fail("JWS_HEADER_REJECTED", "The signed request's header has unexpected contents.");

  try {
    const key = await importJWK(header.data.jwk, "ES256");
    const { payload } = await compactVerify(jws, key, { algorithms: ["ES256"] });
    return ok({ payload: JSON.parse(new TextDecoder().decode(payload)) as unknown, jwk: header.data.jwk });
  } catch {
    return fail("SIGNATURE_INVALID", "The signature doesn't verify.");
  }
}
