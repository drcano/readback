// The tape (SPEC §5.6): the chain of PayPal records behind one charge, in order, each with its
// PayPal object ID and whether the checks that read it passed. Read top to bottom like a receipt.
import { type CaseBundle, type CaseResult, groupFingerprint } from "@readbackhq/core";

type Step = { title: string; id: string | null; detail: string; state: "pass" | "fail" | "caution" | "info"; checks: string[] };

export function tapeSteps(bundle: CaseBundle, r: CaseResult): Step[] {
  const state = (ids: string[]): Step["state"] => {
    const own = r.checks.filter((c) => ids.includes(c.id));
    if (own.some((c) => !c.pass)) return "fail";
    if (own.some((c) => c.secondary || c.provisional)) return "caution";
    return "pass";
  };
  const pu = bundle.order.purchase_units[0];
  const m = r.facts.mandate;
  const tracker = pu?.shipping?.trackers?.find((t) => t.status === "SHIPPED");
  const steps: Step[] = [
    {
      title: r.facts.secondaryTerms ? "Agreement (deleted; using the merchant's copy of the terms)" : "Agreement approved on PayPal",
      id: r.facts.tokenId,
      detail: r.facts.terms ? `Agent key ${groupFingerprint(r.facts.terms.fingerprint)} · ${r.facts.terms.start} to ${r.facts.terms.end}` : "No readable terms",
      state: state(["1", "2a", "4"]),
      checks: ["1", "2a", "4"],
    },
    {
      title: m ? "Request signed by her agent" : "No signed request from her agent",
      id: m ? `${m.mandateHash.slice(0, 16)}…` : null,
      detail: m ? `Signed by ${groupFingerprint(m.fingerprint)} · ${m.payload.qty} × ${m.payload.sku} at USD ${m.payload.unit} · period ${m.payload.p}` : "The order carries no agent signature",
      state: state(["2b", "3"]),
      checks: ["2b", "3"],
    },
    {
      title: "Order and charge",
      id: bundle.order.id,
      detail: `${pu?.invoice_id ?? "no invoice"} · capture ${bundle.capture.id} · USD ${bundle.capture.amount.value} · ${bundle.capture.status}`,
      state: state(["5", "6", "7", "8", "9"]),
      checks: ["5", "6", "7", "8", "9"],
    },
    {
      title: tracker ? "Shipped (merchant-reported)" : "No shipment reported",
      id: tracker?.id ?? null,
      detail: `${bundle.history.filter((h) => h.captureId !== bundle.capture.id && !h.disputed).length} earlier undisputed charge(s) under this agreement`,
      state: state(["10", "11"]),
      checks: ["10", "11"],
    },
  ];
  if (bundle.dispute) {
    steps.push({ title: `Dispute: ${bundle.dispute.reason}`, id: bundle.dispute.dispute_id, detail: `${bundle.dispute.dispute_life_cycle_stage} · ${bundle.dispute.status}`, state: "info", checks: [] });
  }
  return steps;
}

const WORD = { pass: "Pass", caution: "Caution", fail: "Fail", info: "" } as const;

export function Tape({ bundle, result }: { bundle: CaseBundle; result: CaseResult }) {
  return (
    <ol className="tape" aria-label="The chain of PayPal records behind this charge">
      {tapeSteps(bundle, result).map((s) => (
        <li key={s.title} className="tape-step" data-state={s.state}>
          <div className="tape-head">
            <strong>{s.title}</strong>
            {s.state !== "info" && <span className="state" data-state={s.state}>{WORD[s.state]}</span>}
          </div>
          {s.id && <div className="mono">{s.id}</div>}
          <div className="muted small">{s.detail}{s.checks.length > 0 && ` · checks ${s.checks.join(", ")}`}</div>
        </li>
      ))}
    </ol>
  );
}
