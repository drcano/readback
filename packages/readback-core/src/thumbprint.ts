// The agent's fingerprint: the first 16 characters (96 bits) of the base64url RFC 7638 thumbprint
// of its P-256 public key. It's what Maya approves on PayPal's page (SPEC §4.1).
import { calculateJwkThumbprint, type CryptoKey, exportJWK, generateKeyPair } from "jose";
import { type PublicJwk, PublicJwkSchema } from "./jws.ts";

export const FINGERPRINT_LENGTH = 16;

export async function agentFingerprint(jwk: PublicJwk): Promise<string> {
  const { kty, crv, x, y } = jwk;
  return (await calculateJwkThumbprint({ kty, crv, x, y }, "sha256")).slice(0, FINGERPRINT_LENGTH);
}

// For display only: "qX7mP2vL9cRt4sYb" -> "qX7m P2vL 9cRt 4sYb". Never truncate (SPEC §4.1).
// Grouped with spaces, not dashes: "-" is itself a base64url character (ADR 0002).
export function groupFingerprint(fingerprint: string): string {
  return fingerprint.match(/.{1,4}/g)?.join(" ") ?? fingerprint;
}

export type AgentKey = { privateKey: CryptoKey; publicJwk: PublicJwk; fingerprint: string };

// extractable: false is for judge mode's in-tab key: the browser can sign with it but can never
// export it. The agent runtime generates its key once with extractable: true to store in env.
// PayPal's approval page shows the plan name, whose charset has no "_" (spike step 2), so keys are
// drawn until the fingerprint has none (about 78% of keys qualify; 64 tries never realistically fail).
export async function generateAgentKey(extractable: boolean): Promise<AgentKey> {
  for (let i = 0; i < 64; i++) {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable });
    const { kty, crv, x, y } = await exportJWK(publicKey);
    const publicJwk = PublicJwkSchema.parse({ kty, crv, x, y });
    const fingerprint = await agentFingerprint(publicJwk);
    if (!fingerprint.includes("_")) return { privateKey, publicJwk, fingerprint };
  }
  throw new Error("Could not generate an agent key with a displayable fingerprint.");
}
