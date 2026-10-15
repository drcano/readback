"use client";
// The case view (SPEC §5.6). Fetches the case bundle from /api/cases/[id] (live PayPal data), then
// re-runs every check, including the agent's signature, here in the browser with readback-core.
// Fixture IDs (fixture-hero, fixture-twist) build the case in the browser and are labeled as such.
import { type CaseBundle, type CaseResult, evaluateCase, lights } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";
import { useCallback, useEffect, useState } from "react";
import { CheckTable } from "./CheckTable";
import { FourLights } from "./FourLights";
import { Tape } from "./Tape";
import { VerdictPill } from "./ui";
import { reasonLabel, stageLabel } from "@/lib/labels";

type Loaded = { bundle: CaseBundle; server: CaseResult | null; fixture: boolean };
type Verify = { result: CaseResult; ms: number; matchesServer: boolean | null };

async function load(id: string): Promise<Loaded> {
  if (id.startsWith("fixture-")) {
    const wanted = { "fixture-hero": "PP-D-HERO1", "fixture-twist": "PP-D-TWIST" }[id] ?? id.slice("fixture-".length);
    const found = (await fixtureCases()).find((f) => f.id === wanted);
    if (!found) throw new Error("No such fixture.");
    return { bundle: found.bundle, server: null, fixture: true };
  }
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}`);
  const body = (await res.json()) as { ok: boolean; bundle?: CaseBundle; result?: CaseResult; message?: string };
  if (!body.ok || !body.bundle) throw new Error(body.message ?? `Couldn't load this case (HTTP ${res.status}).`);
  return { bundle: body.bundle, server: body.result ?? null, fixture: false };
}

export function CaseView({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ kind: string; text: string } | null>(null);

  async function loadDraft() {
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}/draft`, { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; draft?: { kind: string; text: string } } | null;
    if (body?.ok && body.draft) setDraft(body.draft);
  }
  const [brief, setBrief] = useState<{ sentences: { text: string; cites: string[] }[]; by: string } | null>(null);

  async function explain() {
    setBrief(null);
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}/brief`, { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; brief?: NonNullable<typeof brief> } | null;
    if (body?.ok && body.brief) setBrief(body.brief);
  }

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
  const groups = lights(result.checks);
  // The banner's one-line "why": the first failing group, else the first caution, else all clear.
  const lead = groups.find((g) => g.state === "fail") ?? groups.find((g) => g.state === "caution");
  const why = lead ? `${lead.group}: ${lead.summary}` : "All four groups pass on PayPal's records.";

  return (
    <>
      {loaded.fixture && <p className="banner">Fixture: built in your browser from recorded shapes, not live PayPal data.</p>}
      <h1>
        {result.mode === "preview" ? "Charge preview" : "Dispute"}{" "}
        <span className="mono">{bundle.dispute?.dispute_id ?? bundle.capture.id}</span>
      </h1>
      <ul className="case-meta" aria-label="Case details">
        <li>{result.mode === "preview" ? "Read as if disputed (unauthorized)" : reasonLabel(result.reason)}</li>
        {bundle.dispute && <li>{stageLabel(bundle.dispute.dispute_life_cycle_stage)}</li>}
        <li>${bundle.capture.amount.value} USD</li>
        <li>Captured {new Date(bundle.capture.create_time).toUTCString().replace(" GMT", " UTC")}</li>
      </ul>

      <section className="verdict-banner" data-verdict={c.suggestion ?? "NONE"} aria-labelledby="verdict-h">
        <p className="eyebrow">Suggested outcome · classification row {c.row}</p>
        <div><VerdictPill suggestion={c.suggestion} large /></div>
        <h2 id="verdict-h">{c.label}</h2>
        <p className="verdict-why">{c.suggestion ? why : `${why} The evidence doesn't support a suggestion.`}</p>
        {c.notes.map((n) => <p key={n} className="muted">{n}</p>)}
        <p className="muted small">
          PayPal&apos;s Seller Protection field on this capture: <span className="mono">{bundle.capture.seller_protection?.status ?? "not present"}</span>
        </p>
      </section>

      <FourLights lights={groups} />

      <div className="verify-row">
        <span role="status" className="verified" data-match={verify.matchesServer === false ? "false" : "true"}>
          {verify.matchesServer === false
            ? `✕ Re-verified in your browser in ${verify.ms} ms: does NOT match the server`
            : `✓ Re-verified in your browser in ${verify.ms} ms${verify.matchesServer ? ", matching the server" : ""}`}
        </span>
        <button type="button" className="btn" onClick={() => reverify(loaded)} disabled={busy}>Run again</button>
      </div>

      <div className="actions">
        <section className="card" aria-labelledby="brief-h">
          <h2 id="brief-h">Brief</h2>
          <p>Every sentence must cite a check or a PayPal object; uncited or contradicting drafts are rejected.</p>
          <button type="button" className="btn btn-primary" onClick={explain}>Explain this case</button>
          {brief && (
            <ul aria-label="Case brief">
              {brief.sentences.map((s) => (
                <li key={s.text}>
                  {s.text} {s.cites.map((c) => <span key={c} className="label-chip mono">{c}</span>)}
                </li>
              ))}
              <li className="muted">Written by {brief.by === "claude" ? "Claude, validated by rules" : "rules (Claude unavailable or rejected)"}.</li>
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="merchant-h">
          <h2 id="merchant-h">Merchant</h2>
          <p>Generated from the checks; Sam approves before anything is sent. Sending is disabled on the public demo.</p>
          <button type="button" className="btn" onClick={loadDraft}>Draft a reply to the shopper</button>
          {draft && (
            <figure className="verdict">
              <figcaption className="eyebrow">{draft.kind === "inquiry" ? "Inquiry: her own approval, read back" : draft.kind === "refund" ? "Refund note" : "No draft"}</figcaption>
              {draft.text.split("\n\n").map((para) => <p key={para}>{para}</p>)}
              <button type="button" className="btn" disabled>Send via PayPal (admin only)</button>
            </figure>
          )}
        </section>
      </div>

      <h2>Checks</h2>
      <CheckTable checks={result.checks} />

      <h2>Tape</h2>
      <Tape bundle={bundle} result={result} />
    </>
  );
}
