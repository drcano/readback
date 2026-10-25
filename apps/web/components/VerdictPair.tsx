"use client";
// Two cases side by side, each re-checked in this browser with readback-core: the landing's
// "same claim, two verdicts" and judge mode's "your two verdicts" render the same way.
import { type CaseResult, evaluateCase, groupFingerprint, lights } from "@readback/core";
import { type ReactNode, useEffect, useState } from "react";
import { loadCase } from "@/lib/case-client";
import { recommendation } from "@/lib/labels";
import { FourLights } from "./FourLights";
import { RecPill } from "./ui";

// signedBy/signedAfter wrap the agent fingerprint when the charge carries a valid signed request.
export type Side = { id: string; tag: string; title: string; signedBy: string; signedAfter: string; unsigned: string; note?: string };
type Checked = { result: CaseResult; amount: string; fixture: boolean };

// Loads and re-checks each case; null while loading, an Error when it couldn't be read.
export function useChecked(ids: string[]): { cases: (Checked | Error | null)[]; ms: number } {
  const [state, setState] = useState<{ cases: (Checked | Error | null)[]; ms: number }>({ cases: ids.map(() => null), ms: 0 });
  const key = ids.join("|");
  useEffect(() => {
    let live = true;
    (async () => {
      const loaded = await Promise.all(ids.map((id) => loadCase(id).catch((e: unknown) => (e instanceof Error ? e : new Error("Couldn't load this case.")))));
      const t0 = performance.now();
      const cases = await Promise.all(loaded.map(async (l) => (l instanceof Error ? l : { result: await evaluateCase(l.bundle), amount: l.bundle.capture.amount.value, fixture: l.fixture })));
      if (live) setState({ cases, ms: Math.round(performance.now() - t0) });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the joined key is the dependency
  }, [key]);
  return state;
}

export function VerdictCard({ side, checked, placeholder }: { side: Side; checked: Checked | Error | null; placeholder?: ReactNode }) {
  if (!checked || checked instanceof Error) {
    return (
      <article className="verdict-card" data-rec="pending">
        <p className="mono muted">{side.tag}</p>
        <h3>{side.title}</h3>
        <p className="muted">{checked instanceof Error ? checked.message : placeholder ?? "Checking it in your browser…"}</p>
      </article>
    );
  }
  const c = checked.result.classification;
  const m = checked.result.facts.mandate;
  return (
    <article className="verdict-card" data-rec={recommendation(c.suggestion).key}>
      <div className="pair-top">
        <RecPill suggestion={c.suggestion} />
        <span className="mono muted">{side.tag} · ${checked.amount}</span>
      </div>
      <h3>{side.title}</h3>
      <p className="muted">
        {m ? <>{side.signedBy} <span className="fp">{groupFingerprint(m.fingerprint)}</span>{side.signedAfter}</> : side.unsigned}
      </p>
      <FourLights lights={lights(checked.result.checks)} />
      <p className="muted small">{side.note ?? c.label}</p>
      <a className="btn" href={`/investigator/${encodeURIComponent(side.id)}`}>Open the case</a>
    </article>
  );
}

const fmtMs = (ms: number) => (ms < 1 ? "under 1" : String(ms));
export const checkedIn = (ms: number) => `re-checked in your browser in ${fmtMs(ms)} ms`;

// Judge mode's payoff: the judge's own two charges on their own PayPal agreement, side by side.
export function YourVerdicts({ signed, direct }: { signed: string | null; direct: string | null }) {
  const ids = [signed, direct].filter((x): x is string => Boolean(x));
  const { cases, ms } = useChecked(ids);
  const at = (id: string | null) => (id ? (cases[ids.indexOf(id)] ?? null) : null);
  return (
    <section className="card pair your-verdicts" aria-labelledby="yours-h" aria-live="polite">
      <div className="pair-head">
        <h2 id="yours-h">Your two verdicts</h2>
        <span className="muted">Both charges are on your own agreement, read from PayPal just now</span>
      </div>
      <div className="pair-grid">
        <VerdictCard
          side={{ id: signed ?? "", tag: "Your agent's charge", title: "Your agent asked, within your terms", signedBy: "Signed by your tab's key", signedAfter: ", the one you approved on PayPal.", unsigned: "No valid signed request.", note: "No ruling yet, on purpose: nothing has shipped and a new agreement has no undisputed history. The hero case shows one that has both." }}
          checked={at(signed)}
          placeholder="Step 2 puts your agent's signed charge here."
        />
        <VerdictCard
          side={{ id: direct ?? "", tag: "The store's charge", title: "The store charged your wallet directly", signedBy: "Signed by", signedAfter: ".", unsigned: "Every term respected, but your agent never asked." }}
          checked={at(direct)}
          placeholder="Step 5 puts the store's direct charge here."
        />
      </div>
      {ids.length > 0 && <p className="muted small">{checkedIn(ms).replace(/^./, (c) => c.toUpperCase())}. Readback follows the evidence, even against the store running it.</p>}
    </section>
  );
}
