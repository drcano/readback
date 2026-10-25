"use client";
// "Same claim, two verdicts" (SPEC §0): the moment judges should remember, computed live in this
// browser from two fixture cases with readback-core. Same shopper, same claim; one signed by her
// agent within her terms, one charged by the merchant directly.
import { type CaseResult, evaluateCase, groupFingerprint, lights } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";
import { useEffect, useState } from "react";
import { recommendation } from "@/lib/labels";
import { FourLights } from "./FourLights";
import { RecPill } from "./ui";

type Side = { id: string; amount: string; result: CaseResult };

export function TwoVerdicts() {
  const [sides, setSides] = useState<[Side, Side] | null>(null);
  const [ms, setMs] = useState(0);

  useEffect(() => {
    (async () => {
      const all = await fixtureCases();
      const pick = (id: string) => all.find((f) => f.id === id)!;
      const t0 = performance.now();
      const [hero, twist] = await Promise.all(
        [pick("PP-D-HERO1"), pick("PP-D-TWIST")].map(async (f) => ({ id: f.id, amount: f.bundle.capture.amount.value, result: await evaluateCase(f.bundle) })),
      );
      setMs(Math.round(performance.now() - t0));
      setSides([hero!, twist!]);
    })();
  }, []);

  return (
    <section className="card pair verdicts" aria-labelledby="verdicts-h">
      <div className="pair-head">
        <h2 id="verdicts-h">Same claim, two verdicts</h2>
        <span className="muted">Both say: <em>“I didn&apos;t buy this. My AI did.”</em></span>
      </div>
      {!sides ? (
        <p aria-busy="true">Verifying both cases in your browser…</p>
      ) : (
        <>
          <div className="pair-grid">
            {sides.map((s, i) => {
              const c = s.result.classification;
              const m = s.result.facts.mandate;
              return (
                <article key={s.id} className="verdict-card" data-rec={recommendation(c.suggestion).key}>
                  <div className="pair-top">
                    <RecPill suggestion={c.suggestion} />
                    <span className="mono muted">{i === 0 ? "Charge A" : "Charge B"} · ${s.amount}</span>
                  </div>
                  <h3>{i === 0 ? "Her agent asked, within her terms" : "The merchant charged her wallet directly"}</h3>
                  <p className="muted">
                    {m ? (
                      <>Signed by agent key <span className="fp">{groupFingerprint(m.fingerprint)}</span>, the key she approved on PayPal.</>
                    ) : (
                      "Every term respected, but no signed request from her agent."
                    )}
                  </p>
                  <FourLights lights={lights(s.result.checks)} />
                  <p className="muted small">{c.label}</p>
                  <a className="btn" href={`/investigator/fixture-${i === 0 ? "hero" : "twist"}`}>Open the case</a>
                </article>
              );
            })}
          </div>
          <p className="muted small">
            Both cases were just re-verified in your browser in {ms < 1 ? "under 1" : ms} ms: signatures, terms and all eleven checks. Fixture data, labeled; the live
            versions run against the PayPal sandbox. The rules are the same for both sides: a signed request inside her approved terms protects the seller; a charge her agent never asked for protects the buyer.
          </p>
        </>
      )}
    </section>
  );
}
