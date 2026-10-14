// Agreements (payment tokens) from the merchant side: create the setup token with the terms,
// exchange it after approval, read it back, revoke it. Stores nothing (SPEC §5.1, §5.3a, §5.10).
import {
  agentFingerprint,
  buildSetupTokenRequest,
  type Failure,
  formatTerms,
  parseCustomId,
  parseTerms,
  PaymentTokenSchema,
  type PublicJwk,
  PublicJwkSchema,
  sha256Hex,
  type Terms,
  verifyActionProof,
} from "@readback/core";
import { z } from "zod";
import { findHistory } from "./cases";
import { CATALOG, MERCHANT_NAME } from "./catalog";
import type { PayPalClient } from "./paypal/client";

// What the shopper page sends: the draft terms Maya confirmed on the readback card.
export const DraftSchema = z.strictObject({
  sku: z.string(),
  qty: z.number().int(),
  periodDays: z.number().int(),
  capCents: z.number().int(),
  end: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

const SetupTokenCreated = z.object({ id: z.string(), links: z.array(z.object({ rel: z.string(), href: z.string() })) });

export type CreateResult = { ok: true; approveUrl: string; setupTokenId: string; terms: string } | { ok: false; status: number; failure: Failure };

// The server computes the fingerprint from the key itself; a fingerprint is never accepted as input.
export async function createAgreement(
  paypal: PayPalClient,
  draft: Draft,
  agentJwk: PublicJwk,
  opts: { today: string; baseUrl: string; flow: "maya" | "judge" },
): Promise<CreateResult> {
  if (!CATALOG[draft.sku]) return { ok: false, status: 422, failure: { code: "UNKNOWN_ITEM", message: "That item isn't sold here." } };
  const terms: Terms = { merchant: MERCHANT_NAME, ...draft, start: opts.today, fingerprint: await agentFingerprint(agentJwk) };
  const text = formatTerms(terms);
  const parsed = parseTerms(text); // the round trip enforces every limit in SPEC §4.1
  if (!parsed.ok) return { ok: false, status: 422, failure: parsed.error };
  const body = buildSetupTokenRequest(parsed.value, {
    returnUrl: `${opts.baseUrl}/api/agreements/return?flow=${opts.flow}`,
    cancelUrl: `${opts.baseUrl}/shopper?cancelled=1`,
  });
  if (!body.ok) return { ok: false, status: 422, failure: body.error };
  const res = await paypal.post("/v3/vault/setup-tokens", `rb-setup-${(await sha256Hex(text)).slice(0, 40)}`, body.value, SetupTokenCreated);
  if (!res.ok) return { ok: false, status: 502, failure: { code: "PAYPAL_REFUSED", message: `PayPal couldn't start the approval (${res.issues.join(", ")}).` } };
  const approve = res.data.links.find((l) => l.rel === "approve")?.href;
  if (!approve) return { ok: false, status: 502, failure: { code: "PAYPAL_REFUSED", message: "PayPal returned no approval link." } };
  return { ok: true, approveUrl: approve, setupTokenId: res.data.id, terms: text };
}

// After Maya approves on PayPal: exchange the setup token for the payment token (the agreement).
export async function exchangeSetupToken(paypal: PayPalClient, setupTokenId: string): Promise<{ ok: true; tokenId: string } | { ok: false }> {
  const res = await paypal.post(
    "/v3/vault/payment-tokens",
    `rb-token-${setupTokenId}`,
    { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
    PaymentTokenSchema,
  );
  return res.ok ? { ok: true, tokenId: res.data.id } : { ok: false };
}

export type AgreementView = {
  tokenId: string;
  active: boolean;
  terms: string | null;
  fingerprint: string | null;
  charges: { captureId: string; time: string; period: number | null }[];
};

// GET /api/agreements/[tokenId] (SPEC §5.3a). Merchant-served, so it's never evidence. No personal data.
export async function readAgreement(paypal: PayPalClient, tokenId: string, now: Date, withCharges = true): Promise<AgreementView | null> {
  const res = await paypal.get(`/v3/vault/payment-tokens/${encodeURIComponent(tokenId)}`, PaymentTokenSchema);
  if (!res.ok && res.status !== 404) return null;
  const terms = res.ok ? (res.data.payment_source.paypal.description ?? null) : null;
  const parsed = terms ? parseTerms(terms) : null;
  const charges = parsed?.ok && withCharges
    ? (await findHistory(paypal, tokenId, new Date(`${parsed.value.start}T00:00:00Z`), now, false)).map((h) => ({
        captureId: h.captureId,
        time: h.captureTime,
        period: h.customId ? (parseCustomId(h.customId)?.period ?? null) : null,
      }))
    : [];
  return { tokenId, active: res.ok, terms, fingerprint: parsed?.ok ? parsed.value.fingerprint : null, charges };
}

// DELETE /api/agreements/[tokenId]: a proof signed by the agreement's own agent key, or the admin token.
export async function revokeAgreement(
  paypal: PayPalClient,
  tokenId: string,
  auth: { proof?: string; adminOk: boolean },
  nowSec: number,
): Promise<{ ok: true } | { ok: false; status: number; failure: Failure }> {
  const res = await paypal.get(`/v3/vault/payment-tokens/${encodeURIComponent(tokenId)}`, PaymentTokenSchema);
  if (!res.ok) return { ok: false, status: 404, failure: { code: "AGREEMENT_NOT_ACTIVE", message: "That agreement isn't active." } };
  if (!auth.adminOk) {
    const terms = parseTerms(res.data.payment_source.paypal.description ?? "");
    if (!terms.ok || !auth.proof) return { ok: false, status: 401, failure: { code: "PROOF_REQUIRED", message: "A proof from the agreement's agent key is required." } };
    const v = await verifyActionProof(auth.proof, { tokenId, purpose: "revoke", termsFingerprint: terms.value.fingerprint, nowSec });
    if (!v.ok) return { ok: false, status: 403, failure: v.error };
  }
  const del = await paypal.delete(`/v3/vault/payment-tokens/${encodeURIComponent(tokenId)}`, z.unknown());
  return del.ok ? { ok: true } : { ok: false, status: 502, failure: { code: "PAYPAL_REFUSED", message: "PayPal didn't delete the agreement." } };
}

export async function fetchAgentKey(runtimeUrl: string, fetchImpl: typeof fetch = fetch): Promise<PublicJwk | null> {
  const res = await fetchImpl(`${runtimeUrl}/.well-known/agent-key`).catch(() => null);
  if (!res?.ok) return null;
  const body = z.object({ jwk: PublicJwkSchema }).safeParse(await res.json().catch(() => null));
  return body.success ? body.data.jwk : null;
}
