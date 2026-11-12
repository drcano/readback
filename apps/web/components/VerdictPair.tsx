"use client";
// Two cases side by side, each re-checked in this browser with readback-core: the landing's
// "same claim, two verdicts" and judge mode's "your two verdicts" render the same way.
import { type CaseResult, evaluateCase, groupFingerprint, lights } from "@readback/core";
import { type ReactNode, useEffect, useState } from "react";
import { loadCase } from "@/lib/case-client";
import { paypalRuling, recommendation, type Ruling } from "@/lib/labels";
import { FourLights } from "./FourLights";
import { RecPill } from "./ui";

// `title` shows only while loading; once checked, the card's headline is derived from the evidence,
// so a live pair can never say more than its own checks show (edge case, Oct 26). `note` replaces the
// classification label only while there's no suggestion.
export type Side = { id: string; tag: string; title: string; who: "her" | "your"; note?: string };

function headline(result: CaseResult, who: Side["who"]): { title: string; key: "valid" | "other" | "none" } {
  const m = result.facts.mandate;
  const key = !m ? "none" : result.facts.terms?.fingerprint === m.fingerprint ? "valid" : "other";
  const you = who === "her" ? "she" : "you";
  const termsOk = lights(result.checks).find((l) => l.group === "Terms")?.state !== "fail";
  const title =
    key === "none" ? `The ${who === "her" ? "merchant" : "store"} charged ${who} wallet directly`
    : key === "other" ? `Signed, but not by the key ${you} approved`
    : `${who === "her" ? "Her" : "Your"} agent asked, ${termsOk ? "within" : "outside"} ${who} terms`;
  return { title, key };
}
type Checked = { result: CaseResult; amount: string; fixture: boolean; ruling: Ruling | null };

// Loads and re-checks each case; null while loading, an Error when it couldn't be read.
export function useChecked(ids: string[]): { cases: (Checked | Error | null)[]; ms: number } {
  const [state, setState] = useState<{ cases: (Checked | Error | null)[]; ms: number }>({ cases: ids.map(() => null), ms: 0 });
  const key = ids.join("|");
  useEffect(() => {
    let live = true;
    (async () => {
      const loaded = await Promise.all(ids.map((id) => loadCase(id).catch((e: unknown) => (e instanceof Error ? e : new Error("Couldn't load this case.")))));
      const t0 = performance.now();
      const cases = await Promise.all(
        loaded.map(async (l) => {
          if (l instanceof Error) return l;
          const result = await evaluateCase(l.bundle);
          return { result, amount: l.bundle.capture.amount.value, fixture: l.fixture, ruling: paypalRuling(l.bundle.dispute?.dispute_outcome, result.classification.suggestion) };
        }),
      );
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
        <p className="muted">{checked instanceof Error ? checked.message : placeholder ?? "Reading it from PayPal…"}</p>
      </article>
    );
  }
  const c = checked.result.classification;
  const m = checked.result.facts.mandate;
  const h = headline(checked.result, side.who);
  const you = side.who === "her" ? "she" : "you";
  return (
    <article className="verdict-card" data-rec={recommendation(c.suggestion).key}>
      <div className="pair-top">
        <RecPill suggestion={c.suggestion} />
        <span className="mono muted">{side.tag} · ${checked.amount}</span>
      </div>
      {checked.ruling && (
        // A dispute PayPal already decided: its ruling first, then whether Readback's evidence agrees.
        <p className="ruling-line"><strong>{checked.ruling.label}.</strong> {checked.ruling.agrees === null ? "" : checked.ruling.agrees ? "Readback agrees." : "Readback's evidence disagrees."}</p>
      )}
      <h3>{h.title}</h3>
      <p className="muted">
        {m ? (
          <>Signed by agent key <span className="fp">{groupFingerprint(m.fingerprint)}</span>{h.key === "valid" ? `, the key ${you} approved on PayPal.` : `, not the key ${you} approved on PayPal.`}</>
        ) : (
          `No signed request from ${side.who} agent.`
        )}
      </p>
      <FourLights lights={lights(checked.result.checks)} />
      <p className="muted small">{c.suggestion === null && side.note ? side.note : c.label}</p>
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
          side={{ id: signed ?? "", tag: "Your agent's charge", title: "Your agent asked, within your terms", who: "your", note: "No ruling yet, on purpose: nothing has shipped and a new agreement has no undisputed history. The hero case shows one that has both." }}
          checked={at(signed)}
          placeholder="Step 2 puts your agent's signed charge here."
        />
        <VerdictCard
          side={{ id: direct ?? "", tag: "The store's charge", title: "The store charged your wallet directly", who: "your" }}
          checked={at(direct)}
          placeholder="Step 5 puts the store's direct charge here."
        />
      </div>
      {ids.length > 0 && <p className="muted small">{checkedIn(ms).replace(/^./, (c) => c.toUpperCase())}. Readback follows the evidence, even against the store running it.</p>}
    </section>
  );
}
