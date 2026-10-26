// The evidence statement the store sends into PayPal's dispute (SPEC §5.5 step 8). Written by code
// from the case's checks, so every sentence is true by construction and cites PayPal's own object
// IDs. It reports failed checks as plainly as passed ones (ADR 0004 neutrality), states its limits,
// and tells the investigator how to re-derive it. Sam approves before anything is sent.
import { type CaseBundle, type CaseResult, formatCents, groupFingerprint, lights } from "@readback/core";

const MAX = 2000; // PayPal's limit on evidence and supporting-info notes
const utc = (sec: number) => new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const WORD = { pass: "PASS", caution: "PASS (secondary evidence)", fail: "FAIL" } as const;

export function evidenceStatement(bundle: CaseBundle, result: CaseResult): string {
  const { facts, checks, classification: c } = result;
  const pu = bundle.order.purchase_units[0]!;
  const m = facts.mandate?.payload;
  const failures = (group: string) => checks.filter((k) => k.group === group && !k.pass).flatMap((k) => k.failures.map((f) => `check ${k.id}: ${f.message}`));
  const light = Object.fromEntries(lights(checks).map((l) => [l.group, l])) as Record<string, ReturnType<typeof lights>[number]>;
  const line = (n: number, group: string, facts: string) => {
    const l = light[group]!;
    const why = l.state === "fail" ? ` ${failures(group).join(" ")}` : "";
    return `${n}. ${group}: ${WORD[l.state]}. ${facts}${why}`;
  };
  const trackers = pu.shipping?.trackers?.filter((t) => t.status === "SHIPPED" || t.status === "DELIVERED").map((t) => `${t.id} (${t.status})`) ?? [];
  const history = bundle.history.filter((h) => h.verified && !h.disputed && h.captureId !== bundle.capture.id);
  const subject = bundle.dispute ? `dispute ${bundle.dispute.dispute_id}` : `capture ${bundle.capture.id}`;

  const parts = [
    `Readback evidence for ${subject}, rebuilt from PayPal's own records. Re-derive it with the store's API credentials: npx @readback/verify ${bundle.dispute?.dispute_id ?? bundle.capture.id}`,
    `Charge: capture ${bundle.capture.id}, USD ${bundle.capture.amount.value}, ${utc(facts.captureSec)}, order ${bundle.order.id}${facts.tokenId ? `, under PayPal agreement (vault payment token) ${facts.tokenId}` : ""}.`,
    line(1, "Consent", facts.termsText
      ? `The agreement's terms as PayPal stores them (set at approval; payment tokens can't be edited): "${facts.termsText}".${facts.secondaryTerms ? " The agreement is gone at PayPal, so this is the store's copy." : ""}`
      : "PayPal shows no approved terms for this charge."),
    line(2, "Agent", m && facts.mandate
      ? `The order carries a request signed (ES256) by agent key ${groupFingerprint(facts.mandate.fingerprint)}${facts.terms?.fingerprint === facts.mandate.fingerprint ? ", the key named in those terms" : ""}: agreement ${m.agr}, ${m.qty} x ${m.sku} at USD ${m.unit}, period ${m.p}, signed ${utc(m.iat)}.`
      : "The order carries no valid signed request from the shopper's agent."),
    line(3, "Terms", facts.terms
      ? `Approved: up to ${facts.terms.qty} x ${facts.terms.sku}, max USD ${formatCents(facts.terms.capCents)} per order, once every ${facts.terms.periodDays} day(s), ${facts.terms.start} to ${facts.terms.end}; invoice ${pu.invoice_id ?? "(none)"}.`
      : "The terms can't be read."),
    line(4, "Delivery", `${trackers.length ? `Tracker ${trackers.join(", ")} on the order (merchant-reported)` : "No shipment reported"}; ${history.length} earlier undisputed charge(s) under this agreement verified through PayPal.`),
    c.suggestion === "SELLER_FAVOR"
      ? `Readback's assessment: ${c.label}. ${c.notes.join(" ")}`
      : c.suggestion === "BUYER_FAVOR"
        ? `Readback's assessment: ${c.label}; the evidence supports the buyer.`
        : `Readback's assessment: ${c.label}; the evidence doesn't support a suggestion either way. ${c.notes.join(" ")}`,
    "Limits: the agent-key binding rests on an honest setup and the shopper's fingerprint check at approval (Readback THREAT-MODEL T21); tracking is merchant-reported.",
  ];
  const text = parts.map((p) => p.trim()).join("\n");
  return text.length <= MAX ? text : `${text.slice(0, MAX - 1)}…`;
}
