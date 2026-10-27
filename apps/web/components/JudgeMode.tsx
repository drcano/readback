"use client";
// Judge mode (SPEC §5.7). "Be the agent": this tab generates a NON-extractable P-256 key that lives
// only in memory (gone when the tab closes), approves terms carrying its fingerprint on PayPal in a
// popup (so the tab, and its key, never navigate away), then signs a purchase itself.
// Labeled demo affordance (THREAT-MODEL T31): the one place a private key lives outside the runtime.
import { type AgentKey, generateAgentKey, groupFingerprint, signActionProof } from "@readback/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { signAndBuy } from "@/lib/tab-agent";
import { AgentChat } from "./AgentChat";
import { YourVerdicts } from "./VerdictPair";

const DRAFT = { sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, end: "2027-03-31" };
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return ((await res?.json().catch(() => null)) ?? { ok: false }) as Record<string, unknown> & { ok: boolean };
};
const reason = (r: Record<string, unknown>) =>
  ((r["failures"] as { message: string }[] | undefined)?.map((f) => f.message).join(" ") ?? (r["failure"] as { message: string } | undefined)?.message) || "Something went wrong.";

// Each step says where it stands in words, not only in color.
const STATE_WORD = { done: "Done", ready: "Ready", waiting: "After step 1" } as const;
type StepState = keyof typeof STATE_WORD;
const state = (done: boolean, ready: boolean): StepState => (done ? "done" : ready ? "ready" : "waiting");

function Step({ n, title, s, children }: { n: number; title: string; s: StepState; children: ReactNode }) {
  return (
    <li className="card rail-step" data-state={s}>
      <span className="rail-n" aria-hidden="true">{s === "done" ? "✓" : n}</span>
      <div>
        <div className="rail-head">
          <h3>{n}. {title}</h3>
          <span className="rail-state">{STATE_WORD[s]}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

export function JudgeMode() {
  const [key, setKey] = useState<AgentKey | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [dishonest, setDishonest] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  // One action at a time: a double-click mustn't sign two requests or start two approvals.
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<AgentKey | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  keyRef.current = key;

  // A button that disables itself after success would drop keyboard focus; move it to the result.
  const done = (message: string) => {
    setStatus(message);
    requestAnimationFrame(() => statusRef.current?.focus());
  };
  const once = (action: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      setStatus("Something went wrong in this tab. Reload the page to start again.");
    } finally {
      setBusy(false);
    }
  };

  // The PayPal popup posts the new agreement ID back here (same origin only).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; tokenId?: string };
      // The key lives only in this page's memory: after a reload it's gone, and an approval that
      // names it can't be used from here.
      if (data.type === "rb-agreement" && data.tokenId && !keyRef.current) {
        setStatus("This page was reloaded while PayPal was open, so the key you approved is gone. Press the button in step 1 to make a new key and approve again.");
        return;
      }
      if (data.type === "rb-agreement" && data.tokenId) {
        setTokenId(data.tokenId);
        setBlockedUrl(null);
        setStatus("Approved on PayPal. Your tab's key is now the approved agent.");
      }
      if (data.type === "rb-agreement-cancelled") setStatus("You cancelled on PayPal, so nothing was set up. Press the button to try again.");
      if (data.type === "rb-agreement-failed") setStatus("PayPal's approval didn't complete. Press the button to try again.");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function approve() {
    const k = key ?? (await generateAgentKey(false)); // non-extractable: can sign, can never be exported
    setKey(k);
    const r = await post("/api/agreements", { flow: "judge", draft: DRAFT, jwk: k.publicJwk });
    if (!r.ok) return setStatus(reason(r));
    const url = String(r["approveUrl"]);
    // A blocked popup returns null: offer the same approval page as a link (it still reports back here).
    if (!window.open(url, "paypal-approval", "popup,width=480,height=720")) {
      setBlockedUrl(url);
      return setStatus("Your browser blocked PayPal's approval window. Open it with the link below.");
    }
    setStatus("Approve in the PayPal window with the judge sandbox buyer account (from the Devpost testing instructions). Check the fingerprint first.");
  }

  async function buy() {
    if (!key || !tokenId) return;
    const r = await signAndBuy(key, tokenId, DRAFT.sku, 1);
    if (r.outcome !== "charged") return setStatus(r.message);
    setBought(r.captureId);
    done("Charged. Your tab signed it; the gate verified it; PayPal recorded it.");
  }

  async function beDishonest() {
    if (!key || !tokenId) return;
    const proof = await signActionProof(tokenId, "direct-charge", Math.floor(Date.now() / 1000), key.privateKey, key.publicJwk);
    const r = await post("/api/demo/direct-charge", { tokenId, proof });
    if (!r.ok) return setStatus(reason(r));
    setDishonest(String(r["captureId"]));
    done("The merchant charged your wallet directly. No agent asked.");
  }

  return (
    <section className="try" aria-labelledby="try-h">
      <h2 id="try-h">Try it yourself</h2>
      <p className="muted small">
        Demo affordance: in step 1 this browser tab holds a temporary agent key that can&apos;t be exported and disappears when you close the tab. In production the key lives only in the shopper&apos;s agent runtime.
      </p>
      <ol className="rail">
        <Step n={1} title="Approve" s={state(Boolean(tokenId), true)}>
          <p>Your tab becomes the agent. You approve its terms on PayPal&apos;s own sandbox page, signed in as the judge sandbox buyer from the Devpost testing instructions.</p>
          {key && <p>Your agent&apos;s fingerprint: <span className="fp">{groupFingerprint(key.fingerprint)}</span>. PayPal&apos;s page should show the same 16 characters.</p>}
          <button type="button" className="btn btn-primary" onClick={once(approve)} disabled={busy || Boolean(tokenId)}>Create my key and approve on PayPal</button>
          {blockedUrl && <p><a href={blockedUrl} target="paypal-approval" rel="opener">Open PayPal&apos;s approval page</a> (sign in with the judge sandbox buyer account).</p>}
        </Step>
        <Step n={2} title="Buy" s={state(Boolean(bought), Boolean(tokenId))}>
          <p>Ask Claude to shop: it asks your agent (this tab) to sign, and only what fits your terms gets signed. Or buy in one click.</p>
          <AgentChat agentKey={key} tokenId={tokenId} onCharged={(id) => setBought((b) => b ?? id)} />
          <button type="button" className="btn" onClick={once(buy)} disabled={busy || !tokenId || Boolean(bought)}>Sign and buy one bag</button>
          {bought && <p><a href={`/investigator/${bought}`}>Check this charge</a>: Consent, Agent and Terms pass; Delivery doesn&apos;t yet (nothing shipped, no history), so there&apos;s no suggestion.</p>}
        </Step>
        <Step n={3} title="Dispute" s="ready">
          <p>Disputes are a fixed sandbox pool opened by hand (creating them by API is limited-release at PayPal). Open the seeded hero case instead.</p>
          <a className="btn" href="/investigator">Open the investigator queue</a>
        </Step>
        <Step n={4} title="Investigate" s="ready">
          <p>The hero case: signed by the approved agent, in terms, delivered, with history. Suggested: seller&apos;s favor.</p>
          <a className="btn" href="/investigator/fixture-hero">Open the hero case</a>
        </Step>
        <Step n={5} title="Be a dishonest merchant" s={state(Boolean(dishonest), Boolean(tokenId))}>
          <p>Charge your own agreement directly, every term respected, but with no request from your agent.</p>
          <button type="button" className="btn btn-refund" onClick={once(beDishonest)} disabled={busy || !tokenId || Boolean(dishonest)}>Charge my wallet without my agent</button>
          {dishonest && <p><a href={`/investigator/${dishonest}`}>Check this charge</a>: every term was respected, but the Agent light is red and the evidence supports the buyer. Readback follows the evidence, whoever runs it.</p>}
        </Step>
      </ol>
      <p role="status" aria-live="polite" tabIndex={-1} ref={statusRef}>{status}</p>
      {(bought || dishonest) && <YourVerdicts signed={bought} direct={dishonest} />}
    </section>
  );
}
