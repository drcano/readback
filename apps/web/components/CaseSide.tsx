"use client";
// The case view's side panel: what to do next (brief and drafted reply; nothing is sent from the
// public demo) and the case facts as PayPal shows them.
import type { CaseBundle, CaseResult } from "@readback/core";
import { useState } from "react";
import type { Rec } from "@/lib/labels";

const NEXT: Record<Rec["key"], string> = {
  uphold: "Answer the dispute with her approved limits and her agent's signed request, both from PayPal's records.",
  refund: "The store can't show a request from her agent. Refunding now avoids a lost dispute.",
  review: "The records don't settle it either way. Read the brief, then decide.",
};

export function CaseActions({ id, rec, closed }: { id: string; rec: Rec; closed: boolean }) {
  const [brief, setBrief] = useState<{ sentences: { text: string; cites: string[] }[]; by: string } | null>(null);
  const [draft, setDraft] = useState<{ kind: string; text: string } | null>(null);

  async function explain() {
    setBrief(null);
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}/brief`, { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; brief?: NonNullable<typeof brief> } | null;
    if (body?.ok && body.brief) setBrief(body.brief);
  }
  async function loadDraft() {
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}/draft`, { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; draft?: { kind: string; text: string } } | null;
    if (body?.ok && body.draft) setDraft(body.draft);
  }

  return (
    <section className="card side-card" aria-labelledby="next-h">
      <h2 id="next-h">Next step</h2>
      <p>{closed ? "PayPal has closed this case, so there is nothing left to send." : NEXT[rec.key]}</p>
      <div className="side-actions">
        <button type="button" className="btn btn-primary" onClick={explain}>Explain this case in plain English</button>
        {!closed && <button type="button" className="btn" onClick={loadDraft}>Draft a reply to the shopper</button>}

      </div>
      <p className="side-note">Every sentence in the brief cites a check or a PayPal record. A person approves before anything is sent; sending is off on the public demo.</p>
      {brief && (
        <div className="output" role="status">
          <h3 className="cap">Brief</h3>
          <ul>
            {brief.sentences.map((s) => (
              <li key={s.text}>{s.text} {s.cites.map((c) => <span key={c} className="label-chip mono">{c}</span>)}</li>
            ))}
          </ul>
          <p className="muted small">Written by {brief.by === "claude" ? "Claude, validated by rules" : "rules (Claude unavailable or rejected)"}.</p>
        </div>
      )}
      {draft && (
        <div className="output" role="status">
          <h3 className="cap">{draft.kind === "inquiry" ? "Reply: her own approval, read back" : draft.kind === "refund" ? "Refund note" : "No draft"}</h3>
          {draft.text.split("\n\n").map((para) => <p key={para}>{para}</p>)}
        </div>
      )}
    </section>
  );
}

export function CaseFacts({ bundle, result, stage }: { bundle: CaseBundle; result: CaseResult; stage: string | null }) {
  const due = bundle.dispute?.seller_response_due_date;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <section className="card side-card" aria-labelledby="facts-h">
      <h2 id="facts-h">Case facts</h2>
      <dl className="facts">
        <dt>Amount</dt><dd><strong>${bundle.capture.amount.value}</strong></dd>
        {result.facts.terms && (<><dt>Store</dt><dd>{result.facts.terms.merchant}</dd></>)}
        <dt>Charged</dt><dd>{fmt(bundle.capture.create_time)}</dd>
        {stage && (<><dt>Stage</dt><dd>{stage}</dd></>)}
        <dt>Respond by</dt><dd>{due ? fmt(due) : "—"}</dd>
        {bundle.capture.status.includes("REFUNDED") && (<><dt>Refund</dt><dd>PayPal shows <span className="mono">{bundle.capture.status}</span></dd></>)}
        {bundle.dispute?.dispute_channel === "EXTERNAL" && (<><dt>Channel</dt><dd>Card issuer chargeback</dd></>)}
        <dt>Seller Protection</dt><dd>PayPal shows <span className="mono">{bundle.capture.seller_protection?.status ?? "not present"}</span></dd>
        <dt>Capture</dt><dd className="mono">{bundle.capture.id}</dd>
      </dl>
    </section>
  );
}

// The store's evidence, sent into PayPal's own dispute (SPEC §5.4–5.5). The statement shown here is
// computed in this browser from the same PayPal records; the server rebuilds it from PayPal before
// sending, so what PayPal receives is never text typed here. Sending needs the store's admin token.
export function EvidenceToPayPal({ id, statement, live, rec, amount }: { id: string; statement: string; live: boolean; rec: Rec; amount: string }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; onPayPalRecord?: boolean; via?: string } | null>(null);

  // Two answers, both written by the server from PayPal's records: send the evidence, or accept the
  // claim and refund (when the evidence supports the buyer, that's Readback's recommendation).
  async function send(action: "send_evidence" | "refund_buyer") {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setResult(((await res?.json().catch(() => null)) as typeof result) ?? { ok: false, message: "Couldn't reach the store's server." });
    setBusy(false);
  }

  return (
    <section className="card side-card" aria-labelledby="evidence-h">
      <h2 id="evidence-h">Answer PayPal</h2>
      <p>Readback&apos;s statement for this dispute, citing PayPal&apos;s own records. Failed checks are reported as plainly as passed ones.</p>
      <details className="evidence">
        <summary>Read the statement ({statement.length} characters)</summary>
        <pre>{statement}</pre>
      </details>
      {live ? (
        <form className="side-actions" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="admin-token" className="small">Store admin token</label>
          <input id="admin-token" type="password" className="field" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <button type="button" className={`btn ${rec.key === "refund" ? "" : "btn-primary"}`} disabled={busy || !token} onClick={() => void send("send_evidence")}>
            {busy ? "Working with PayPal…" : "Send the evidence to PayPal"}
          </button>
          <button type="button" className={`btn ${rec.key === "refund" ? "btn-refund" : ""}`} disabled={busy || !token} onClick={() => void send("refund_buyer")}>
            Accept the claim and refund ${amount}
          </button>
        </form>
      ) : (
        <p className="side-note">Labeled example case: there&apos;s no PayPal dispute to send it to.</p>
      )}
      {result && (
        <p role="status" className={result.ok ? "verified" : "banner"}>
          {result.ok && result.onPayPalRecord ? "✓ " : ""}{result.message}{result.via ? ` (via ${result.via.replaceAll("_", " ")})` : ""}
        </p>
      )}
      <p className="side-note">The server rebuilds the statement from PayPal at send time and sends it with whichever action PayPal offers on this dispute. Sending twice is a no-op.</p>
    </section>
  );
}
