"use client";
// Verifiable Intent import: Mastercard's VI autonomous chain, as the payment network sees it,
// checked in this browser with readback-core. The issuer key defaults to VI's published demo key
// and says so; clear it and the issuer signature is reported unresolved, not passed.
import { evaluateViChain, PublicJwkSchema, VI_DEMO_ISSUER_JWK, VI_EXAMPLE_CHAIN, type ViChain, type ViResult } from "@readbackhq/core";
import { useEffect, useState } from "react";
import { MandateCheck } from "./Ap2View";

const DEMO_KEY = JSON.stringify(VI_DEMO_ISSUER_JWK);
const FIELDS = [
  { id: "l1", label: "L1: the issuer's credential for her key (SD-JWT)" },
  { id: "l2", label: "L2: her mandate, as disclosed to the network (SD-JWT)" },
  { id: "l3a", label: "L3a: her agent's payment (SD-JWT)" },
] as const;

async function check(chain: ViChain, issuerKey: string): Promise<ViResult | string> {
  if (!issuerKey.trim()) return evaluateViChain(chain);
  let parsed: unknown;
  try {
    parsed = JSON.parse(issuerKey);
  } catch {
    parsed = null;
  }
  const jwk = PublicJwkSchema.safeParse(parsed);
  if (!jwk.success) return "The issuer key isn't a P-256 public JWK (kty, crv, x, y). Clear it to skip the issuer check.";
  const label = issuerKey.trim() === DEMO_KEY ? "VI's published demo issuer key" : "the issuer key above";
  return evaluateViChain(chain, { jwk: jwk.data, label });
}

export function ViView() {
  const [chain, setChain] = useState<ViChain>(VI_EXAMPLE_CHAIN);
  const [issuerKey, setIssuerKey] = useState(DEMO_KEY);
  const [result, setResult] = useState<ViResult | string | null>(null);

  useEffect(() => {
    check(VI_EXAMPLE_CHAIN, DEMO_KEY).then(setResult);
  }, []);

  return (
    <>
      {FIELDS.map((f) => (
        <div key={f.id}>
          <label htmlFor={`vi-${f.id}`}>{f.label}</label>
          <textarea id={`vi-${f.id}`} className="field mono" rows={3} value={chain[f.id]} onChange={(e) => setChain({ ...chain, [f.id]: e.target.value })} />
        </div>
      ))}
      <label htmlFor="vi-issuer">Issuer public key (JWK). Defaults to the demo key VI publishes with its examples.</label>
      <textarea id="vi-issuer" className="field mono" rows={2} value={issuerKey} onChange={(e) => setIssuerKey(e.target.value)} />
      <p>
        <button type="button" className="btn btn-primary" onClick={() => check(chain, issuerKey).then(setResult)}>Check in my browser</button>{" "}
        <button type="button" className="btn" onClick={() => { setChain(VI_EXAMPLE_CHAIN); setIssuerKey(DEMO_KEY); void check(VI_EXAMPLE_CHAIN, DEMO_KEY).then(setResult); }}>Use VI&apos;s example</button>
      </p>
      {typeof result === "string" && <p role="alert" className="state" data-state="fail">{result}</p>}
      {result && typeof result !== "string" && <MandateCheck result={result} standard="Verifiable Intent chain" products="VI keeps products in its checkout mandate, which goes only to the merchant" />}
    </>
  );
}
