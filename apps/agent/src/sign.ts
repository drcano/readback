// The runtime's signing step (SPEC §5.2 request_reorder). It fails closed twice:
//  1. it refuses to act under terms that don't carry its own fingerprint (THREAT-MODEL T21), and
//  2. it never signs a request that falls outside those terms (readback-core's pre-check).
import { buildMandate, parseTerms, type AgentKey, type Result, sha256Hex, signMandate, TokenIdSchema } from "@readback/core";
import { z } from "zod";

export const ReorderInputSchema = z.strictObject({
  agreement: TokenIdSchema, // payment token ID
  terms: z.string().max(127), // the agreement's terms, as relayed by the merchant's agreement endpoint
  sku: z.string(),
  qty: z.number().int(),
  unitCents: z.number().int(),
});
export type ReorderInput = z.infer<typeof ReorderInputSchema>;

export async function signReorder(key: AgentKey, input: ReorderInput, nowSec: number): Promise<Result<{ jws: string }>> {
  const terms = parseTerms(input.terms);
  if (!terms.ok) return terms;
  if (terms.value.fingerprint !== key.fingerprint) {
    return { ok: false, error: { code: "NOT_MY_AGREEMENT", message: "These terms name a different agent key; refusing to act under them." } };
  }
  const ctx = { tokenId: input.agreement, terms: terms.value, termsHash: await sha256Hex(input.terms) };
  const built = buildMandate({ sku: input.sku, qty: input.qty, unitCents: input.unitCents }, ctx, nowSec, crypto.randomUUID());
  if (!built.ok) return built;
  return { ok: true, value: { jws: await signMandate(built.value, key.privateKey, key.publicJwk) } };
}
