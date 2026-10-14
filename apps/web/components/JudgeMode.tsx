"use client";
// Judge mode (SPEC §5.7). "Be the agent": this tab generates a NON-extractable P-256 key that lives
// only in memory (gone when the tab closes), approves terms carrying its fingerprint on PayPal in a
// popup (so the tab, and its key, never navigate away), then signs a purchase itself.
// Labeled demo affordance (THREAT-MODEL T31): the one place a private key lives outside the runtime.
import { type AgentKey, buildMandate, generateAgentKey, groupFingerprint, parseTerms, sha256Hex, signActionProof, signMandate } from "@readback/core";
import { CATALOG } from "@readback/core/catalog";
import { useEffect, useState } from "react";

const DRAFT = { sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, end: "2027-03-31" };
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return ((await res?.json().catch(() => null)) ?? { ok: false }) as Record<string, unknown> & { ok: boolean };
};
const reason = (r: Record<string, unknown>) =>
  ((r["failures"] as { message: string }[] | undefined)?.map((f) => f.message).join(" ") ?? (r["failure"] as { message: string } | undefined)?.message) || "Something went wrong.";

export function JudgeMode() {
  const [key, setKey] = useState<AgentKey | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [dishonest, setDishonest] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  // The PayPal popup posts the new agreement ID back here (same origin only).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; tokenId?: string };
      if (data.type === "rb-agreement" && data.tokenId) {
        setTokenId(data.tokenId);
        setStatus("Approved on PayPal. Your tab's key is now the approved agent.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function approve() {
    const k = key ?? (await generateAgentKey(false)); // non-extractable: can sign, can never be exported
    setKey(k);
    const r = await post("/api/agreements", { flow: "judge", draft: DRAFT, jwk: k.publicJwk });
    if (!r.ok) return setStatus(reason(r));
    window.open(String(r["approveUrl"]), "paypal-approval", "popup,width=480,height=720");
    setStatus("Approve in the PayPal window with the judge sandbox account. Check the fingerprint first.");
  }

  async function buy() {
    if (!key || !tokenId) return;
    const view = await (await fetch(`/api/agreements/${encodeURIComponent(tokenId)}`)).json() as { terms?: string };
    const terms = view.terms ? parseTerms(view.terms) : null;
    if (!terms?.ok) return setStatus("Couldn't read your agreement's terms from PayPal.");
    const built = buildMandate({ sku: DRAFT.sku, qty: 1, unitCents: CATALOG[DRAFT.sku]!.unitCents }, { tokenId, terms: terms.value, termsHash: await sha256Hex(view.terms!) }, Math.floor(Date.now() / 1000), crypto.randomUUID());
    if (!built.ok) return setStatus(built.error.message);
    const r = await post("/api/checkout", { mandate: await signMandate(built.value, key.privateKey, key.publicJwk) });
    if (!r.ok) return setStatus(reason(r));
    setBought(String(r["captureId"]));
    setStatus("Charged. Your tab signed it; the gate verified it; PayPal recorded it.");
  }

  async function beDishonest() {
    if (!key || !tokenId) return;
    const proof = await signActionProof(tokenId, "direct-charge", Math.floor(Date.now() / 1000), key.privateKey, key.publicJwk);
    const r = await post("/api/demo/direct-charge", { tokenId, proof });
    if (!r.ok) return setStatus(reason(r));
    setDishonest(String(r["captureId"]));
    setStatus("The merchant charged your wallet directly. No agent asked.");
  }

  return (
    <>
      <p className="banner">
        Demo affordance: in step 1 this browser tab holds a temporary agent key that can't be exported and disappears when you close the tab. In production the key lives only in the shopper's agent runtime.
      </p>
      <ol className="rail">
        <li>
          <h2>1. Approve</h2>
          <p>Your tab becomes the agent. You approve its terms on PayPal's own page.</p>
          {key && <p>Your agent's fingerprint: <span className="fp">{groupFingerprint(key.fingerprint)}</span>. PayPal's page should show the same 16 characters.</p>}
          <button type="button" onClick={approve} disabled={Boolean(tokenId)}>Create my key and approve on PayPal</button>
        </li>
        <li>
          <h2>2. Buy</h2>
          <p>Your tab signs one in-terms purchase. The merchant's gate verifies it and charges the saved wallet.</p>
          <button type="button" onClick={buy} disabled={!tokenId || Boolean(bought)}>Sign and buy one bag</button>
          {bought && <p><a href={`/investigator/${bought}`}>Check this charge</a>: Consent, Agent and Terms pass; Delivery doesn't yet (nothing shipped, no history), so there's no suggestion.</p>}
        </li>
        <li>
          <h2>3. Dispute</h2>
          <p>Disputes are a fixed, hand-opened sandbox pool; PayPal doesn't allow creating them by API. Open the seeded hero case instead.</p>
          <a href="/investigator">Open the investigator queue</a>
        </li>
        <li>
          <h2>4. Investigate</h2>
          <p>The hero case: signed by the approved agent, in terms, delivered, with history. Suggested: seller's favor.</p>
          <a href="/investigator/fixture-hero">Open the hero case</a>
        </li>
        <li>
          <h2>5. Be a dishonest merchant</h2>
          <p>Charge your own agreement directly, every term respected, but with no request from your agent.</p>
          <button type="button" onClick={beDishonest} disabled={!tokenId || Boolean(dishonest)}>Charge my wallet without my agent</button>
          {dishonest && <p><a href={`/investigator/${dishonest}`}>Check this charge</a>: the Agent light is red and the suggestion is buyer's favor, against the merchant running Readback.</p>}
        </li>
      </ol>
      <p role="status" aria-live="polite">{status}</p>
    </>
  );
}
