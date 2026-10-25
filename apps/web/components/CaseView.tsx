"use client";
// The case view (SPEC §5.6). Fetches the case bundle from /api/cases/[id] (live PayPal data), then
// re-runs every check, including the agent's signature, here in the browser with readback-core.
// Fixture IDs (fixture-hero, fixture-twist) build the case in the browser and are labeled as such.
import { type CaseResult, evaluateCase, lights } from "@readback/core";
import { useCallback, useEffect, useState } from "react";
import { type Loaded, loadCase as load } from "@/lib/case-client";
import { claimQuote, paypalRuling, reasonLabel, recommendation, stageLabel } from "@/lib/labels";
import { CaseActions, CaseFacts } from "./CaseSide";
import { EvidenceChain } from "./EvidenceChain";
import { CheckTable } from "./CheckTable";
import { Tape } from "./Tape";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Verify = { result: CaseResult; ms: number; matchesServer: boolean | null };

const UPHOLD_WHY = "Her own AI agent asked for this exact order, inside the limits she approved on PayPal. The charge was authorized, even if she doesn't remember it.";

export function CaseView({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reverify = useCallback(async (data: Loaded) => {
    setBusy(true);
    const t0 = performance.now();
    const result = await evaluateCase(data.bundle);
    const ms = Math.round(performance.now() - t0);
    const matchesServer = data.server
      ? data.server.classification.code === result.classification.code && data.server.failed.join() === result.failed.join()
      : null;
    setVerify({ result, ms, matchesServer });
    setBusy(false);
  }, []);

  useEffect(() => {
    load(id)
      .then((data) => {
        setLoaded(data);
        return reverify(data);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load this case."));
  }, [id, reverify]);

  if (error) return <p role="alert" className="banner">{error}</p>;
  if (!loaded || !verify) return <p aria-busy="true" className="lede">Fetching the case from PayPal and re-checking it in your browser…</p>;

  const { bundle } = loaded;
  const { result } = verify;
  const c = result.classification;
  const rec = recommendation(c.suggestion);
  const ruling = paypalRuling(bundle.dispute?.dispute_outcome, c.suggestion);
  const groups = lights(result.checks);
  const lead = groups.find((g) => g.state === "fail") ?? groups.find((g) => g.state === "caution");
  const why = rec.key === "uphold" ? UPHOLD_WHY : rec.key === "refund" && lead ? lead.summary : `${c.label}. The evidence doesn't support a recommendation either way, so a person should look.`;
  const terms = result.facts.terms;

  return (
    <div className="case-layout">
      <div className="case-main">
        {loaded.fixture && <p className="banner">Fixture: built in your browser from recorded PayPal shapes, not live data.</p>}
        <p className="cap">
          {result.mode === "preview" ? "Charge preview, read as if disputed" : `${reasonLabel(result.reason)} claim`} · <span className="mono">{bundle.dispute?.dispute_id ?? bundle.capture.id}</span>
        </p>
        <h1>{result.mode === "preview" ? "If she disputed this charge…" : `The shopper says: ${claimQuote(result.reason)}`}</h1>
        <p className="case-sub">
          ${bundle.capture.amount.value}
          {terms ? ` to ${terms.merchant}` : ""}
          {bundle.order.purchase_units[0]?.items?.[0] ? ` for ${bundle.order.purchase_units[0].items[0].quantity} × ${bundle.order.purchase_units[0].items[0].name}` : ""}
          , charged {fmtDate(bundle.capture.create_time)}.
        </p>

        {ruling && (
          <section className="card ruling-banner" aria-labelledby="ruling-h">
            <p className="cap">PayPal's decision{bundle.dispute?.update_time ? ` · ${fmtDate(bundle.dispute.update_time)}` : ""}</p>
            <h2 id="ruling-h">{ruling.label}</h2>
            {ruling.reason && <p>Reason PayPal gives: {ruling.reason}.</p>}
            <p className="muted">This case is closed. Below, Readback re-checks it against PayPal's records.</p>
          </section>
        )}

        <section className="card rec-banner" data-rec={rec.key} data-closed={ruling ? "true" : undefined} aria-labelledby="rec-h">
          <p className="cap">{ruling ? "Readback's check against it" : "Readback recommends"}</p>
          <h2 id="rec-h">{ruling ? ruling.check : rec.label}</h2>
          <p>{ruling ? `Readback would have recommended: ${rec.label.toLowerCase()}. ${why}` : why}</p>
          {c.notes.map((n) => <p key={n} className="muted">{n}</p>)}
        </section>

        <EvidenceChain bundle={bundle} result={result} groups={groups} verify={verify} />

        <details className="card more">
          <summary>All 11 checks and the PayPal records behind them</summary>
          <p className="muted small">
            Classification row {c.row} ({c.code}).{" "}
            <button type="button" className="btn" onClick={() => reverify(loaded)} disabled={busy}>Re-check in this browser</button>
          </p>
          <h3>Checks</h3>
          <CheckTable checks={result.checks} />
          <h3>Tape</h3>
          <Tape bundle={bundle} result={result} />
        </details>
      </div>

      <aside className="case-side" aria-label="Case actions and facts">
        <CaseActions id={id} rec={rec} amount={bundle.capture.amount.value} closed={ruling !== null} />
        <CaseFacts bundle={bundle} result={result} stage={bundle.dispute ? stageLabel(bundle.dispute.dispute_life_cycle_stage) : null} />
      </aside>
    </div>
  );
}
