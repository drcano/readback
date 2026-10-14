"use client";
// Maya delegates once (SPEC §5.1): instruction → readback card → PayPal approval → her agreement.
// The page never shows the agent fingerprint: she compares what her own agent shows with what
// PayPal's page shows (THREAT-MODEL T21). Everything after approval is read live from PayPal.
import { useEffect, useState } from "react";
import type { Draft } from "@/lib/agreements";
import { readbackCard } from "@/lib/readback-card";

const STORY = "Reorder Biscuit's Salmon & Rice Adult (24 lb) from Good Boy Provisions, one bag per 30 days, up to $65 per order, through March 31, 2027.";
const STORY_DRAFT: Draft = { sku: "GBP-SR24", qty: 1, periodDays: 30, capCents: 6500, end: "2027-03-31" };

type Compiled = { draft: Draft; card: string; questions: string[] };
type View = { active: boolean; charges: { captureId: string; time: string; period: number | null }[] };

export function ShopperFlow({ agreement, notice }: { agreement: string | null; notice: string | null }) {
  const [instruction, setInstruction] = useState(STORY);
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    if (!agreement) return;
    fetch(`/api/agreements/${encodeURIComponent(agreement)}`)
      .then((r) => r.json() as Promise<View & { ok: boolean }>)
      .then((v) => (v.ok ? setView(v) : setError("Couldn't read your agreement from PayPal.")))
      .catch(() => setError("Couldn't reach the shop."));
  }, [agreement]);

  async function compile() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/terms/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as (Compiled & { ok: boolean; message?: string }) | null;
    setBusy(false);
    if (body?.ok) setCompiled(body);
    else setError(body?.message ?? "Couldn't draft terms right now. You can use the example terms instead.");
  }

  async function approve(draft: Draft) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/agreements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flow: "maya", draft }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; approveUrl?: string; failure?: { message: string } } | null;
    if (body?.ok && body.approveUrl) {
      window.location.assign(body.approveUrl); // to PayPal's own approval page
      return;
    }
    setBusy(false);
    setError(body?.failure?.message ?? "Couldn't start the PayPal approval.");
  }

  if (agreement) {
    return (
      <section aria-labelledby="agr-h">
        <h2 id="agr-h">Your agreement</h2>
        <p className="mono">{agreement}</p>
        {error && <p role="alert">{error}</p>}
        {!view && !error && <p aria-busy="true">Reading it from PayPal…</p>}
        {view && (
          <>
            <p>
              Status: <strong>{view.active ? "Active on PayPal" : "Cancelled"}</strong>
            </p>
            <h3>What your agent has bought</h3>
            {view.charges.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <ul>
                {view.charges.map((c) => (
                  <li key={c.captureId}>
                    {new Date(c.time).toUTCString()}: period {c.period ?? "?"} · receipt <span className="mono">{c.captureId}</span> ·{" "}
                    <a href={`/investigator/${encodeURIComponent(c.captureId)}`}>check this charge</a>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">To cancel: PayPal › Settings › Payments › Manage automatic payments, or ask your agent to revoke it.</p>
          </>
        )}
      </section>
    );
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <section aria-labelledby="step1">
        <h2 id="step1">1. Tell your agent what it may buy</h2>
        <label htmlFor="instruction">Your instruction</label>
        <textarea id="instruction" rows={3} maxLength={500} value={instruction} onChange={(e) => setInstruction(e.target.value)} className="field" />
        <p>
          <button type="button" onClick={compile} disabled={busy || instruction.trim().length < 3}>Read it back to me</button>{" "}
          <button type="button" onClick={() => setCompiled({ draft: STORY_DRAFT, card: readbackCard(STORY_DRAFT), questions: [] })} disabled={busy}>
            Use the example terms
          </button>
        </p>
      </section>

      {compiled && (
        <section aria-labelledby="step2" className="verdict">
          <h2 id="step2">2. Is this what you mean?</h2>
          <p><strong>{compiled.card}</strong></p>
          {compiled.questions.map((q) => <p key={q} className="muted">To confirm: {q}</p>)}
          <h3>3. Check your agent's fingerprint</h3>
          <p>
            Your agent will show you its fingerprint: 16 characters in four groups. PayPal's approval page will show
            the same 16 characters at the end of the terms. Approve only if they match.
          </p>
          <button type="button" onClick={() => approve(compiled.draft)} disabled={busy}>Approve on PayPal</button>
        </section>
      )}
    </>
  );
}
