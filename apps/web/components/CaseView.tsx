"use client";
// The case view (SPEC §5.6). Fetches the case bundle from /api/cases/[id] (live PayPal data), then
// re-runs every check, including the agent's signature, here in the browser with readback-core.
// Fixture IDs (fixture-hero, fixture-twist) build the case in the browser and are labeled as such.
import { type CaseBundle, type CaseResult, evaluateCase, groupFingerprint, lights } from "@readback/core";
import { directCharge, heroCase } from "@readback/core/fixtures";
import { useCallback, useEffect, useState } from "react";
import { CheckTable } from "./CheckTable";
import { FourLights } from "./FourLights";

type Loaded = { bundle: CaseBundle; server: CaseResult | null; fixture: boolean };
type Verify = { result: CaseResult; ms: number; matchesServer: boolean | null };

async function load(id: string): Promise<Loaded> {
  if (id === "fixture-hero" || id === "fixture-twist") {
    const hero = await heroCase();
    return { bundle: id === "fixture-hero" ? hero.bundle : directCharge(hero), server: null, fixture: true };
  }
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}`);
  const body = (await res.json()) as { ok: boolean; bundle?: CaseBundle; result?: CaseResult; message?: string };
  if (!body.ok || !body.bundle) throw new Error(body.message ?? `Couldn't load this case (HTTP ${res.status}).`);
  return { bundle: body.bundle, server: body.result ?? null, fixture: false };
}

const SUGGESTION = {
  SELLER_FAVOR: "Suggested outcome: seller's favor",
  BUYER_FAVOR: "Suggested outcome: buyer's favor (refund)",
} as const;

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

  if (error) return <p role="alert">{error}</p>;
  if (!loaded || !verify) return <p aria-busy="true">Fetching the case from PayPal and re-verifying it in your browser…</p>;

  const { bundle } = loaded;
  const { result } = verify;
  const c = result.classification;
  const pu = bundle.order.purchase_units[0];
  const fingerprint = result.facts.terms?.fingerprint;

  return (
    <>
      {loaded.fixture && <p className="banner">Fixture: built in your browser from recorded shapes, not live PayPal data.</p>}
      <h1>
        {result.mode === "preview" ? "Charge preview" : "Dispute"}{" "}
        <span className="mono">{bundle.dispute?.dispute_id ?? bundle.capture.id}</span>
      </h1>
      <p className="muted">
        {result.mode === "preview" ? "Read as if disputed (UNAUTHORISED). " : `${result.reason} · ${bundle.dispute?.dispute_life_cycle_stage} · `}
        USD {bundle.capture.amount.value} · captured {new Date(bundle.capture.create_time).toUTCString()}
      </p>

      <section className="verdict" aria-labelledby="verdict-h">
        <h2 id="verdict-h" className="eyebrow">Classification (row {c.row})</h2>
        <strong>{c.label}</strong>
        <p>{c.suggestion ? SUGGESTION[c.suggestion] : "No suggested outcome: the evidence doesn't support one."}</p>
        {c.notes.map((n) => <p key={n} className="muted">{n}</p>)}
        <p className="muted">
          PayPal's Seller Protection field on this capture: <span className="mono">{bundle.capture.seller_protection?.status ?? "not present"}</span>
        </p>
      </section>

      <FourLights lights={lights(result.checks)} />

      <p>
        <button type="button" onClick={() => reverify(loaded)} disabled={busy}>Re-verify in this browser</button>{" "}
        <span role="status" className="muted">
          Re-verified locally in {verify.ms} ms
          {verify.matchesServer === true && ", matching the server's result."}
          {verify.matchesServer === false && ". It does NOT match the server's result."}
        </span>
      </p>

      <h2>Checks</h2>
      <CheckTable checks={result.checks} />

      <h2>Tape</h2>
      <ol className="mono">
        <li>Agreement {result.facts.tokenId ?? "(none attested by PayPal)"}: {result.facts.termsText ?? "no terms"}</li>
        {fingerprint && <li>Approved agent key <span className="fp">{groupFingerprint(fingerprint)}</span></li>}
        <li>Signed request: {result.facts.mandate ? <>signed by <span className="fp">{groupFingerprint(result.facts.mandate.fingerprint)}</span>, period {result.facts.mandate.payload.p}</> : "none"}</li>
        <li>Order {bundle.order.id}: {pu?.invoice_id ?? "no invoice"}</li>
        <li>Capture {bundle.capture.id}: {bundle.capture.status}</li>
        <li>Tracker: {pu?.shipping?.trackers?.map((t) => `${t.id} ${t.status}`).join(", ") || "none"}</li>
        {bundle.dispute && <li>Dispute {bundle.dispute.dispute_id}: {bundle.dispute.status}</li>}
      </ol>
    </>
  );
}
