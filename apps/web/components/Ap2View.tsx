"use client";
// AP2 import (SPEC §4.6): an AP2 v0.2 payment mandate chain, checked in this browser with
// readback-core, next to the same idea expressed natively on PayPal. Anything that can't be
// checked is shown as "unresolved", never as a pass. MandateCheck is shared with /vi.
import { AP2_EXAMPLE_CHAIN, type Ap2Result, evaluateAp2Chain, groupFingerprint } from "@readbackhq/core";
import { useEffect, useState } from "react";

const WORD = { pass: "Pass", fail: "Fail", unresolved: "Unresolved" } as const;
const LIGHT = { pass: "pass", fail: "fail", unresolved: "caution" } as const;

// The checked chain, and the same agreement in Readback's terms. `standard` names whose mandate it
// is; `products` says where that standard keeps what was bought.
export function MandateCheck({ result, standard, products }: { result: Ap2Result; standard: string; products: string }) {
  const verdict = result.verdict === "allow" ? "Within the mandate" : result.verdict === "deny" ? "Outside the mandate" : "Unresolved: some constraints can't be checked here";
  return (
    <div className="verdict-pair">
      <article className="verdict-card" data-outcome={result.verdict === "allow" ? "SELLER_FAVOR" : result.verdict === "deny" ? "BUYER_FAVOR" : "none"}>
        <p className="eyebrow">{standard}, checked by readback-core</p>
        <h3>{verdict}</h3>
        {result.purchase && <p className="muted">Agent&apos;s payment: {result.purchase.currency} {(result.purchase.amountCents / 100).toFixed(2)} to payee <span className="mono">{result.purchase.payeeId}</span></p>}
        <ul className="plain">
          {result.findings.map((f) => (
            <li key={f.item}>
              <span className="state" data-state={LIGHT[f.status]}>{WORD[f.status]}</span> <strong>{f.item}</strong>
              <div className="muted small">{f.detail}</div>
            </li>
          ))}
        </ul>
      </article>
      <article className="verdict-card">
        <p className="eyebrow">The same agreement on PayPal rails, today</p>
        <h3>Readback terms</h3>
        <ul className="plain">
          <li><strong>Merchant:</strong> {result.mapped.merchant ?? "—"}</li>
          <li><strong>Cap per order:</strong> {result.mapped.capCents === null ? "—" : `USD ${(result.mapped.capCents / 100).toFixed(2)}`}</li>
          <li><strong>Agent key fingerprint:</strong> {result.mapped.fingerprint ? <span className="fp">{groupFingerprint(result.mapped.fingerprint)}</span> : "—"}</li>
          <li><strong>Not in its payment mandate:</strong> {result.mapped.notApplicable.join(", ")} ({products})</li>
        </ul>
        <p className="muted small">
          On PayPal, these terms live in the payment token Maya approves; PayPal&apos;s own invoice uniqueness enforces one purchase per period,
          which is what the standard&apos;s budget and recurrence constraints need stored state for. Analogous, not identical.
        </p>
      </article>
    </div>
  );
}

export function Ap2View() {
  const [chain, setChain] = useState(AP2_EXAMPLE_CHAIN);
  const [result, setResult] = useState<Ap2Result | null>(null);

  useEffect(() => {
    evaluateAp2Chain(AP2_EXAMPLE_CHAIN).then(setResult);
  }, []);

  return (
    <>
      <label htmlFor="ap2-chain">AP2 payment mandate chain (open ~~ closed, SD-JWT)</label>
      <textarea id="ap2-chain" className="field mono" rows={5} value={chain} onChange={(e) => setChain(e.target.value)} />
      <p>
        <button type="button" className="btn btn-primary" onClick={() => evaluateAp2Chain(chain).then(setResult)}>Check in my browser</button>{" "}
        <button type="button" className="btn" onClick={() => { setChain(AP2_EXAMPLE_CHAIN); void evaluateAp2Chain(AP2_EXAMPLE_CHAIN).then(setResult); }}>Use AP2's official example</button>
      </p>
      {result && <MandateCheck result={result} standard="AP2 v0.2 mandate" products="AP2 keeps products in its checkout mandate" />}
    </>
  );
}
