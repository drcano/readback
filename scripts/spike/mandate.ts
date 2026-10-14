// Spike-only: builds the SPEC §4 strings (terms, signed mandate, custom_id, invoice_id) so the
// spike sends PayPal exactly the shapes and sizes the product will. readback-core replaces this.
import { calculateJwkThumbprint, CompactSign, exportJWK, generateKeyPair } from "jose";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(digest).toString("hex");
}

// `terms` is optional (the `?`): step 1 has no real agreement, so buildCharge invents terms.
// Steps 3+ pass the real token's description so the order's copy byte-equals it.
export type Purchase = { tokenId: string; sku: string; qty: number; unit: string; period: number; terms?: string };

export async function buildCharge(p: Purchase) {
  // A throwaway P-256 agent key. Production uses AGENT_PRIVATE_KEY in apps/agent.
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const { kty, crv, x, y } = await exportJWK(publicKey);
  const jwk = { kty, crv, x, y }; // exactly these four members (SPEC §4.3)
  const fingerprint = (await calculateJwkThumbprint(jwk, "sha256")).slice(0, 16);

  // Spike-honest caveat: with real terms, their fingerprint came from step 2's throwaway key, not
  // this one, so the mandate would fail Readback's fingerprint check. PayPal doesn't care; the
  // spike only tests what PayPal stores and returns. (`??` = Python's `x if x is not None else y`.)
  const terms =
    p.terms ??
    `RB1 Good Boy Provisions | ${p.sku} x${p.qty}/30d | max USD 65.00 | 2026-10-14..2027-03-31 | agent ${fingerprint}`;
  const termsHash = await sha256Hex(terms);
  const amt = ((Math.round(Number(p.unit) * 100) * p.qty) / 100).toFixed(2);

  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1, agr: p.tokenId, th: termsHash.slice(0, 16),
    sku: p.sku, qty: p.qty, unit: p.unit, amt, cur: "USD",
    p: p.period, iat, exp: iat + 300, jti: crypto.randomUUID(),
  };
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "ES256", typ: "rb-mandate+jwt", jwk })
    .sign(privateKey);
  const mandateHash = await sha256Hex(jws);

  const nnn = String(p.period).padStart(3, "0");
  return {
    terms, termsHash, jws, mandateHash, amt, fingerprint,
    invoiceId: `RB-${p.tokenId}-P${nnn}`,
    customId: `rb1:${p.tokenId}:${termsHash.slice(0, 16)}:p${nnn}:${mandateHash.slice(0, 16)}`,
  };
}
