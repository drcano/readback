// The judge's browser tab as the shopper's agent (SPEC §5.7, THREAT-MODEL T31). It does what the agent
// runtime does before signing (refuses terms that don't name its key, refuses anything outside them),
// signs with its non-extractable key, and submits to the merchant's checkout gate.
import { type AgentKey, buildMandate, parseTerms, sha256Hex, signMandate } from "@readback/core";
import { CATALOG } from "@readback/core/catalog";

export type TabResult =
  | { outcome: "charged"; captureId: string; message: string }
  | { outcome: "refused"; message: string } // the tab's own pre-check: nothing was signed
  | { outcome: "denied"; message: string }; // signed, but the gate or PayPal said no

export async function signAndBuy(key: AgentKey, tokenId: string, sku: string, qty: number, fetchImpl: typeof fetch = fetch): Promise<TabResult> {
  const res = await fetchImpl(`/api/agreements/${encodeURIComponent(tokenId)}`).catch(() => null);
  const view = ((await res?.json().catch(() => null)) ?? {}) as { terms?: string | null; message?: string };
  // Say which side failed: the shop (unreachable, or its own rate limit) isn't PayPal or her agreement.
  if (!res) return { outcome: "refused", message: "The shop couldn't be reached, so your agent didn't sign anything. Try again." };
  if (res.status === 429) return { outcome: "refused", message: `${view.message ?? "Too many requests."} Your agent didn't sign anything.` };
  const terms = view.terms ? parseTerms(view.terms) : null;
  if (!terms?.ok) return { outcome: "refused", message: "Your agent couldn't read your agreement's terms from PayPal, so it didn't sign anything." };
  if (terms.value.fingerprint !== key.fingerprint) return { outcome: "refused", message: "Those terms name a different agent key, so your agent won't act under them." };
  const unitCents = CATALOG[sku]?.unitCents;
  if (unitCents === undefined) return { outcome: "refused", message: `Your agent refused to sign: ${sku} isn't in the shop's catalog.` };

  const built = buildMandate({ sku, qty, unitCents }, { tokenId, terms: terms.value, termsHash: await sha256Hex(view.terms!) }, Math.floor(Date.now() / 1000), crypto.randomUUID());
  if (!built.ok) return { outcome: "refused", message: `Your agent refused to sign: ${built.error.message}` };

  const sent = await fetchImpl("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mandate: await signMandate(built.value, key.privateKey, key.publicJwk) }) }).catch(() => null);
  const body = ((await sent?.json().catch(() => null)) ?? { ok: false }) as { ok: boolean; captureId?: string; invoiceId?: string; failures?: { message: string }[] };
  if (body.ok && body.captureId) return { outcome: "charged", captureId: body.captureId, message: `Your agent signed ${qty} × ${sku}; the store's gate verified it and PayPal charged it (${body.invoiceId}).` };
  return { outcome: "denied", message: `Your agent signed it, but it was refused: ${body.failures?.map((f) => f.message).join(" ") ?? "the shop couldn't be reached."}` };
}
