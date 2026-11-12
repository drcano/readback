// "How we know, from PayPal's records": the four check groups as a numbered chain, each with its
// plain-language result and the facts behind it, all read from the bundle and readback-core's result.
import { type CaseBundle, type CaseResult, formatCents, groupFingerprint, type Light } from "@readbackhq/core";
import type { CaseRecord } from "@/lib/case-stream";
import { stepTitle } from "@/lib/labels";
import { RebuiltSummary } from "./LiveRebuild";

const SYMBOL = { pass: "✓", caution: "!", fail: "✕" } as const;

function factsFor(group: Light["group"], bundle: CaseBundle, result: CaseResult): string[] {
  const t = result.facts.terms;
  const m = result.facts.mandate;
  const pu = bundle.order.purchase_units[0];
  switch (group) {
    case "Consent":
      return t ? [`Approved ${t.start}, valid until ${t.end}`, `Agent key ${groupFingerprint(t.fingerprint)}`, result.facts.secondaryTerms ? "Only the store's copy of the terms" : "Terms stored by PayPal, unedited"] : ["No approved terms found at PayPal"];
    case "Agent":
      if (!m) return ["No signed request on this order", "Every agent purchase carries one"];
      return [`Signed by key ${groupFingerprint(m.fingerprint)}`, t && m.fingerprint === t.fingerprint ? "Same key she approved" : "Not the key she approved"];
    case "Terms":
      return t ? [`$${bundle.capture.amount.value} against a $${formatCents(t.capCents)} cap`, `${t.sku} × ${t.qty} approved`, t.periodDays === 1 ? "At most one order a day" : `At most one order every ${t.periodDays} days`] : [];
    case "Delivery": {
      const shipped = pu?.shipping?.trackers?.some((x) => x.status === "SHIPPED");
      const prior = bundle.history.filter((h) => h.verified && !h.disputed).length;
      return [shipped ? "Shipment tracking reported" : "No shipment reported", `${prior} earlier undisputed order${prior === 1 ? "" : "s"} verified`];
    }
  }
}

export function EvidenceChain({ bundle, result, groups, verify, rebuilt }: { bundle: CaseBundle; result: CaseResult; groups: Light[]; verify: { ms: number; matchesServer: boolean | null }; rebuilt: { records: CaseRecord[]; ms: number } | null }) {
  return (
    <section className="card chain" aria-labelledby="chain-h">
      <div className="chain-head">
        <h2 id="chain-h">How we know, from PayPal&apos;s records</h2>
        <span role="status" className="verified" data-match={verify.matchesServer === false ? "false" : "true"}>
          {verify.matchesServer === false ? `✕ Re-checked in your browser: does NOT match the server` : `✓ Re-checked in your browser in ${verify.ms < 1 ? "under 1" : verify.ms} ms${verify.matchesServer ? " · matches" : ""}`}
        </span>
      </div>
      {rebuilt && rebuilt.records.length > 0 && <RebuiltSummary records={rebuilt.records} ms={rebuilt.ms} />}
      <ol>
        {groups.map((l, i) => (
          <li key={l.group} className="link" data-state={l.state}>
            <span className="badge" data-state={l.state} aria-hidden="true">{i + 1}</span>
            <div>
              <h3>{stepTitle(l)} <span aria-hidden="true">{SYMBOL[l.state]}</span></h3>
              <p>{l.summary}</p>
              <ul className="kv" aria-label={`${l.group} facts`}>
                {factsFor(l.group, bundle, result).map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
