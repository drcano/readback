"use client";
// "Try to break it": each attack runs through the product's real layers in this browser (evals/lab.ts)
// and shows where it was stopped. One attack at a time as a pipeline, or all of them as a grid.
import { ATTACKS, type Layer, type Outcome, type Stop, stoppedAt } from "@readback/evals/lab";
import { useEffect, useState } from "react";

const LAYERS: { id: Layer; name: string; who: string }[] = [
  { id: "runtime", name: "Agent runtime", who: "her agent: signs only what fits her terms" },
  { id: "gate", name: "Checkout gate", who: "the store: verifies before charging" },
  { id: "paypal", name: "PayPal", who: "duplicate guard, cancelled agreements" },
  { id: "investigator", name: "Investigator", who: "rebuilds a dispute from PayPal's records" },
];
const WORD: Record<Outcome, string> = { passed: "Passed", stopped: "Stopped here", caught: "Caught here", bypassed: "Bypassed", "not reached": "Not reached" };
const SYMBOL: Record<Outcome, string> = { passed: "✓", stopped: "✕", caught: "✕", bypassed: "↷", "not reached": "–" };
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function AttackLab() {
  const [selected, setSelected] = useState(ATTACKS[1]!.id);
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [shown, setShown] = useState(0); // layers revealed so far, for the step-by-step reveal
  const [grid, setGrid] = useState<Record<string, Stop[]> | null>(null);
  const attack = ATTACKS.find((a) => a.id === selected)!;

  useEffect(() => {
    let live = true;
    setStops(null);
    setShown(0);
    attack.run().then((s) => {
      if (!live) return;
      setStops(s);
      if (reduced()) return setShown(s.length);
      s.forEach((_, i) => setTimeout(() => live && setShown(i + 1), 350 * (i + 1)));
    });
    return () => {
      live = false;
    };
  }, [attack]);

  async function runAll() {
    const rows = await Promise.all(ATTACKS.map(async (a) => [a.id, await a.run()] as const));
    setGrid(Object.fromEntries(rows));
  }

  const end = stops && shown >= stops.length ? stoppedAt(stops) : null;
  return (
    <section className="card lab" aria-labelledby="lab-h">
      <div className="pair-head">
        <h2 id="lab-h">Try to break it</h2>
        <span className="muted small">Real code, in your browser. Every attack assumes her AI assistant was fooled.</span>
      </div>
      <div className="chips lab-picker" role="group" aria-label="Choose an attack">
        {ATTACKS.map((a) => (
          <button key={a.id} type="button" className="chip" aria-pressed={a.id === selected} onClick={() => setSelected(a.id)}>{a.title}</button>
        ))}
      </div>
      <p className="lab-story">{attack.story}</p>
      <ol className="pipeline" aria-label="Where this attack went">
        {LAYERS.map((l, i) => {
          const s = stops && i < shown ? stops[i] : null;
          return (
            <li key={l.id} className="stage" data-outcome={s?.outcome ?? "pending"}>
              <span className="cap">{l.name}</span>
              <strong className="stage-state">{s ? <><span aria-hidden="true">{SYMBOL[s.outcome]} </span>{WORD[s.outcome]}</> : "…"}</strong>
              <p>{s?.detail || l.who}</p>
            </li>
          );
        })}
      </ol>
      <p className="lab-verdict" aria-live="polite">
        {end === null ? "" : end === "none" ? "It went through, as an honest purchase should." : `Stopped at the ${LAYERS.find((l) => l.id === end)!.name.toLowerCase()}.`}
      </p>

      <div className="lab-all">
        <button type="button" className="btn" onClick={runAll}>Run all {ATTACKS.length} attacks</button>
        {grid && (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Where each attack was stopped</caption>
              <thead>
                <tr><th scope="col">Attack</th>{LAYERS.map((l) => <th key={l.id} scope="col">{l.name}</th>)}</tr>
              </thead>
              <tbody>
                {ATTACKS.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">{a.title}</th>
                    {grid[a.id]!.map((s) => (
                      <td key={s.layer} className="grid-cell" data-outcome={s.outcome}><span aria-hidden="true">{SYMBOL[s.outcome]} </span>{WORD[s.outcome]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
