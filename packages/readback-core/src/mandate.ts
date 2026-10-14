// The closed mandate (SPEC §4.3): one agent-signed request per purchase, stored in the order's
// items[0].description. The agent runtime builds and signs it; the gate and the investigator verify it.
import type { CryptoKey } from "jose";
import { z } from "zod";
import { sha256Hex } from "./hash.ts";
import { TokenIdSchema } from "./ids.ts";
import { type PublicJwk, signJws, verifyJws } from "./jws.ts";
import { formatCents, parseCents } from "./money.ts";
import { fail, type Failure, ok, type Result } from "./result.ts";
import { periodIndex, type Terms, withinDates } from "./terms.ts";
import { agentFingerprint } from "./thumbprint.ts";

export const MANDATE_TTL_SEC = 300;
export const CLOCK_SKEW_SEC = 60; // tolerance between runtime, gate and PayPal clocks (T27)

const MoneyString = z.string().refine((v) => (parseCents(v) ?? 0) > 0, "positive canonical amount");

export const MandatePayloadSchema = z.strictObject({
  v: z.literal(1),
  agr: TokenIdSchema, // payment token ID = the agreement
  th: z.string().regex(/^[0-9a-f]{16}$/), // first 16 hex of termsHash
  sku: z.string().regex(/^[A-Z0-9-]{1,16}$/),
  qty: z.number().int().min(1).max(999),
  unit: MoneyString,
  amt: MoneyString,
  cur: z.literal("USD"),
  p: z.number().int().min(1).max(999),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  jti: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type MandatePayload = z.infer<typeof MandatePayloadSchema>;

export type VerifiedMandate = {
  payload: MandatePayload;
  jwk: PublicJwk;
  fingerprint: string; // of the key that signed it
  mandateHash: string; // sha256 hex of the exact JWS string; an index, not a security control
};

// Signature + shape + internal consistency. Says nothing yet about *whose* key signed it:
// that's checkAgainstTerms, against the fingerprint Maya approved.
export async function verifyMandate(jws: string): Promise<Result<VerifiedMandate>> {
  const verified = await verifyJws(jws, "rb-mandate+jwt");
  if (!verified.ok) return verified;
  const parsed = MandatePayloadSchema.safeParse(verified.value.payload);
  if (!parsed.success) return fail("MANDATE_MALFORMED", "The signed request has unexpected contents.");
  const m = parsed.data;
  if (parseCents(m.amt) !== parseCents(m.unit)! * m.qty || formatCents(parseCents(m.amt)!) !== m.amt) {
    return fail("MANDATE_MALFORMED", "The signed total doesn't equal unit price times quantity.");
  }
  if (m.exp <= m.iat || m.exp - m.iat > MANDATE_TTL_SEC) {
    return fail("MANDATE_MALFORMED", "The signed request's validity window is wrong.");
  }
  return ok({
    payload: m,
    jwk: verified.value.jwk,
    fingerprint: await agentFingerprint(verified.value.jwk),
    mandateHash: await sha256Hex(jws),
  });
}

export type TermsContext = {
  tokenId: string;
  terms: Terms;
  termsHash: string; // full sha256 hex of the exact terms string
  merchant?: string; // the merchant running the gate; omitted where it doesn't apply
};

// Does this request fit the approved terms? Returns *every* failure, not just the first,
// so a denial or a case view can explain itself completely. Empty array = fits.
export function checkAgainstTerms(m: MandatePayload, signerFingerprint: string, ctx: TermsContext): Failure[] {
  const { terms } = ctx;
  const out: Failure[] = [];
  const add = (code: string, message: string) => out.push({ code, message });
  const amt = parseCents(m.amt)!;

  if (signerFingerprint !== terms.fingerprint) add("KEY_NOT_APPROVED", "It wasn't signed by the agent key approved on PayPal.");
  if (m.agr !== ctx.tokenId) add("WRONG_AGREEMENT", "It was signed for a different agreement.");
  if (m.th !== ctx.termsHash.slice(0, 16)) add("TERMS_HASH_MISMATCH", "It was signed against different terms.");
  if (ctx.merchant !== undefined && ctx.merchant !== terms.merchant) add("WRONG_MERCHANT", `The agreement is with ${terms.merchant}, not ${ctx.merchant}.`);
  if (m.sku !== terms.sku) add("SKU_NOT_APPROVED", `Your agreement covers ${terms.sku} only.`);
  if (m.qty > terms.qty) add("QTY_OVER_LIMIT", `Your agreement allows up to ${terms.qty} per order.`);
  if (amt > terms.capCents) add("OVER_CAP", `Your agreement allows up to USD ${formatCents(terms.capCents)} per order.`);
  if (!withinDates(m.iat, terms)) add("OUTSIDE_DATES", `Your agreement runs ${terms.start} to ${terms.end}.`);
  else if (m.p !== periodIndex(m.iat, terms)) add("WRONG_PERIOD", "It names a different period than the one it was signed in.");
  return out;
}

// Gate-only: is the request fresh right now? iat may be up to 60s in the future (clock skew).
export function checkFreshness(m: MandatePayload, nowSec: number): Failure[] {
  if (m.iat > nowSec + CLOCK_SKEW_SEC) return [{ code: "NOT_YET_VALID", message: "The signed request is dated in the future." }];
  if (nowSec > m.exp) return [{ code: "EXPIRED", message: "The signed request expired; ask your agent again." }];
  return [];
}

export type ReorderRequest = { sku: string; qty: number; unitCents: number };

// The runtime's pre-check (SPEC §5.2 request_reorder): build the payload and refuse anything
// outside the terms *before* signing. The runtime never signs a request that wouldn't fit.
export function buildMandate(
  req: ReorderRequest,
  ctx: TermsContext,
  nowSec: number,
  jti: string,
): Result<MandatePayload> {
  if (!Number.isInteger(req.unitCents) || req.unitCents <= 0 || req.unitCents > 999_999) {
    return fail("MANDATE_MALFORMED", "The price isn't valid.");
  }
  const p = periodIndex(nowSec, ctx.terms) ?? 1;
  const candidate = {
    v: 1, agr: ctx.tokenId, th: ctx.termsHash.slice(0, 16), sku: req.sku, qty: req.qty,
    unit: formatCents(req.unitCents), amt: formatCents(req.unitCents * req.qty), cur: "USD",
    p, iat: nowSec, exp: nowSec + MANDATE_TTL_SEC, jti,
  };
  const parsed = MandatePayloadSchema.safeParse(candidate);
  if (!parsed.success) return fail("MANDATE_MALFORMED", "That request can't be expressed as a valid mandate.");
  const failures = checkAgainstTerms(parsed.data, ctx.terms.fingerprint, ctx);
  if (failures.length > 0) return { ok: false, error: failures[0]! };
  return ok(parsed.data);
}

export function signMandate(payload: MandatePayload, privateKey: CryptoKey, jwk: PublicJwk): Promise<string> {
  return signJws(payload, "rb-mandate+jwt", privateKey, jwk);
}
