// Action proofs (SPEC §4.7): a short JWS proving the caller holds the agreement's agent key,
// used to authorize revoke and the demo direct charge.
import type { CryptoKey } from "jose";
import { z } from "zod";
import { TokenIdSchema } from "./ids.ts";
import { type PublicJwk, signJws, verifyJws } from "./jws.ts";
import { fail, ok, type Result } from "./result.ts";
import { agentFingerprint } from "./thumbprint.ts";

export const ACTION_WINDOW_SEC = 60;
export const ActionPurposeSchema = z.enum(["revoke", "direct-charge"]);
export type ActionPurpose = z.infer<typeof ActionPurposeSchema>;

const ActionPayloadSchema = z.strictObject({
  tokenId: TokenIdSchema,
  purpose: ActionPurposeSchema,
  iat: z.number().int().nonnegative(),
});

export function signActionProof(
  tokenId: string, purpose: ActionPurpose, nowSec: number, privateKey: CryptoKey, jwk: PublicJwk,
): Promise<string> {
  return signJws({ tokenId, purpose, iat: nowSec }, "rb-action+jwt", privateKey, jwk);
}

export async function verifyActionProof(
  jws: string,
  expected: { tokenId: string; purpose: ActionPurpose; termsFingerprint: string; nowSec: number },
): Promise<Result<{ fingerprint: string }>> {
  const verified = await verifyJws(jws, "rb-action+jwt");
  if (!verified.ok) return verified;
  const parsed = ActionPayloadSchema.safeParse(verified.value.payload);
  if (!parsed.success) return fail("ACTION_MALFORMED", "The action proof has unexpected contents.");
  const a = parsed.data;
  if (a.purpose !== expected.purpose) return fail("ACTION_WRONG_PURPOSE", "The proof was made for a different action.");
  if (a.tokenId !== expected.tokenId) return fail("WRONG_AGREEMENT", "The proof was made for a different agreement.");
  if (Math.abs(a.iat - expected.nowSec) > ACTION_WINDOW_SEC) return fail("ACTION_STALE", "The proof is too old or dated in the future.");
  const fingerprint = await agentFingerprint(verified.value.jwk);
  if (fingerprint !== expected.termsFingerprint) return fail("KEY_NOT_APPROVED", "The proof wasn't signed by this agreement's agent key.");
  return ok({ fingerprint });
}
