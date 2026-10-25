"use client";
// "Judge it yourself" (SPEC §5.9): runs the labeled eval scenarios and a seeded tamper sample in
// THIS browser, against the product's own code (core, gate, agent signer, guards) and the
// in-memory PayPal fake. Nothing is sent anywhere.
import { type Outcome, runScenarios, summarize } from "@readback/evals";
import { tamperSample } from "@readback/evals/tamper";
import { useState } from "react";

type Board = { summary: ReturnType<typeof summarize>; tamper: Awaited<ReturnType<typeof tamperSample>>; failed: Outcome[]; ms: number };

const ROWS: [keyof ReturnType<typeof summarize>["metrics"], string][] = [
  ["gateAccuracy", "Gate decisions correct"],
  ["attacksBlockedAtRuntime", "Attack pages blocked at the agent runtime"],
  ["attacksBlockedAtGate", "Attack pages blocked at the gate"],
  ["signatureAttacksCaught", "Signature attacks caught"],
  ["rulingsCorrect", "Dispute suggestions correct"],
  ["sellerShouldWin", "…where the evidence supports the seller"],
  ["buyerShouldWin", "…where the evidence supports the buyer"],
  ["noSuggestionDue", "…where the evidence supports neither (no suggestion)"],
  ["guards", "Guards (proofs, demo fencing, webhooks, formats)"],
];

export function JudgeItYourself() {
  const [board, setBoard] = useState<Board | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const t0 = performance.now();
    const results = await runScenarios();
    const tamper = await tamperSample(1000, Math.floor(Math.random() * 2 ** 31));
    setBoard({ summary: summarize(results), tamper, failed: results.filter((r) => !r.pass), ms: Math.round(performance.now() - t0) });
    setRunning(false);
  }

  return (
    <>
      <p>
        <button type="button" className="btn btn-primary" onClick={run} disabled={running}>{running ? "Running in your browser…" : "Run every scenario in my browser"}</button>
      </p>
      {board && (
        <section aria-labelledby="board-h" aria-live="polite">
          <h2 id="board-h">
            {board.summary.passed}/{board.summary.scenarios} scenarios behaved as labeled · {board.ms} ms
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">Measure</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {ROWS.map(([k, label]) => {
                  const v = board.summary.metrics[k] as { passed: number; total: number };
                  return <tr key={k}><td>{label}</td><td className="mono">{v.passed}/{v.total}</td></tr>;
                })}
                <tr><td>Wrong suggestions toward the seller</td><td className="mono">{board.summary.metrics.wrongTowardSeller}</td></tr>
                <tr><td>Wrong suggestions toward the buyer</td><td className="mono">{board.summary.metrics.wrongTowardBuyer}</td></tr>
                <tr>
                  <td>Tamper sample: random single-field mutations of the hero case still earning seller's favor (seed {board.tamper.seed})</td>
                  <td className="mono">{board.tamper.kept}/{board.tamper.mutations - board.tamper.unchanged}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {board.failed.length > 0 && (
            <ul role="alert">{board.failed.map((f) => <li key={f.id}>{f.id}: expected {f.expected}, got {f.actual}</li>)}</ul>
          )}
          <p className="muted small">The scenarios are our own. The code and fixtures are open, so you can add your own and run them the same way (`pnpm eval`).</p>
        </section>
      )}
    </>
  );
}
