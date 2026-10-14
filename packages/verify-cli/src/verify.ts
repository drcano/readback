// Rebuild a case from PayPal and run the eleven checks: the same code the investigator view runs,
// without the merchant's hosted app. It still needs API access to the merchant's PayPal account,
// because PayPal returns only an account's own disputes and captures (SPEC §5.8: "re-derivable").
import { type CaseResult, evaluateCase, groupFingerprint, lights } from "@readback/core";
import { buildCaseBundle } from "./cases.ts";
import type { PayPalClient } from "./paypal-client.ts";

export async function verifyCase(id: string, paypal: PayPalClient, now: Date): Promise<{ ok: true; result: CaseResult } | { ok: false; message: string }> {
  const lookup = await buildCaseBundle(id, paypal, now);
  if (!lookup.ok) return { ok: false, message: lookup.message };
  return { ok: true, result: await evaluateCase(lookup.bundle) };
}

const SYMBOL = { pass: "✓", caution: "!", fail: "✕" } as const;

export function report(id: string, r: CaseResult): string {
  const c = r.classification;
  const lines = [
    `Readback verify: ${id} (${r.mode === "preview" ? "preview, read as if disputed" : r.reason})`,
    "",
    lights(r.checks).map((l) => `${l.group} ${SYMBOL[l.state]}`).join("   "),
    "",
    ...r.checks.map((k) => `  ${k.pass ? "PASS" : "FAIL"}  ${k.id.padEnd(3)} ${k.name}${k.failures.length ? `: ${k.failures.map((f) => f.message).join(" ")}` : ""}${k.secondary ? " [secondary terms]" : ""}${k.provisional ? " [provisional]" : ""}`),
    "",
    `Classification: row ${c.row}, ${c.label}`,
    `Suggested outcome: ${c.suggestion ?? "none"}`,
    ...c.notes.map((n) => `  ${n}`),
  ];
  if (r.facts.mandate) lines.push(`Signed by agent key ${groupFingerprint(r.facts.mandate.fingerprint)}; approved key ${r.facts.terms ? groupFingerprint(r.facts.terms.fingerprint) : "unknown"}`);
  return lines.join("\n");
}
