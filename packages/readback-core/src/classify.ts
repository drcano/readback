// Classification (SPEC §5.6): deterministic, first matching row wins, and every result lists all
// failed checks. A suggestion is only made when the evidence supports one; otherwise it's null.
import type { CaseBundle, DisputeReason } from "./case.ts";
import { type CaseFacts, type CheckId, type CheckResult, runChecks } from "./checks.ts";

export type Suggestion = "BUYER_FAVOR" | "SELLER_FAVOR" | null;

export type Classification = {
  row: number;
  code: string;
  label: string;
  suggestion: Suggestion;
  notes: string[]; // modifiers applied, evidence to supply, routing
};

export type CaseResult = {
  mode: "dispute" | "preview"; // preview = a capture with no dispute, read "if disputed"
  reason: DisputeReason;
  facts: CaseFacts;
  checks: CheckResult[];
  failed: CheckId[];
  classification: Classification;
};

const OUT_OF_SCOPE: DisputeReason[] = ["CREDIT_NOT_PROCESSED", "PAYMENT_BY_OTHER_MEANS", "PROBLEM_WITH_REMITTANCE", "OTHER"];

export async function evaluateCase(bundle: CaseBundle): Promise<CaseResult> {
  const { facts, checks } = await runChecks(bundle);
  const mode = bundle.dispute ? "dispute" : "preview";
  const reason: DisputeReason = bundle.dispute?.reason ?? "UNAUTHORISED";
  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  const c = applyModifiers(classify(reason, new Set(failed)), checks, facts);
  const classification = { ...c, notes: [...c.notes, ...contextNotes(bundle)] };
  return { mode, reason, facts, checks, failed, classification };
}

// Facts an investigator needs to read a suggestion correctly, stated, never used to decide one
// (edge cases, Oct 26): a refund already made, a card issuer deciding instead of PayPal, and a
// dispute that covers more than the charge evaluated here.
function contextNotes(b: CaseBundle): string[] {
  const notes: string[] = [];
  if (b.capture.status === "REFUNDED") notes.push("PayPal shows this charge fully refunded already.");
  if (b.capture.status === "PARTIALLY_REFUNDED") notes.push("PayPal shows this charge partly refunded already.");
  if (b.dispute?.dispute_channel === "EXTERNAL") notes.push("A card issuer's chargeback: the issuer decides, and PayPal's outcome doesn't bind it.");
  const txns = b.dispute?.disputed_transactions ?? [];
  if (txns.length > 1) {
    const others = txns.map((t) => t.seller_transaction_id).filter((id): id is string => Boolean(id) && id !== b.capture.id);
    notes.push(`This dispute covers ${txns.length} charges; this evaluation is of ${b.capture.id}. Check the others separately: ${others.join(", ")}.`);
  }
  return notes;
}

function row(row: number, code: string, label: string, suggestion: Suggestion, notes: string[] = []): Classification {
  return { row, code, label, suggestion, notes };
}

export function classify(reason: DisputeReason, failed: ReadonlySet<CheckId>): Classification {
  const any = (...ids: CheckId[]) => ids.some((id) => failed.has(id));
  if (OUT_OF_SCOPE.includes(reason)) return row(0, "OUT_OF_SCOPE", "Out of scope", null);
  if (any("1", "2a")) return row(1, "NOT_AGENT_AGREEMENT", "Not an agent-agreement charge", null);
  if (any("4")) return row(2, "CHARGED_AFTER_REVOCATION", "Charged after revocation", "BUYER_FAVOR");
  if (any("2b", "3")) return row(3, "NO_VALID_AGENT_REQUEST", "No valid agent request", "BUYER_FAVOR");
  if (any("5", "6", "7", "8", "9")) return row(4, "OUTSIDE_TERMS", "Charged outside approved terms", "BUYER_FAVOR");
  switch (reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      return any("10")
        ? row(5, "NON_FULFILLMENT", "Non-fulfillment", "BUYER_FAVOR")
        : row(6, "SHIPMENT_REPORTED", "Shipment reported (merchant-attested)", null, ["Supply PROOF_OF_FULFILLMENT."]);
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      return row(7, "ITEM_MATCHES_APPROVED", "Item matches the signed and approved SKU; contents unverifiable", null);
    case "INCORRECT_AMOUNT":
      return row(8, "AMOUNT_AS_AUTHORIZED", "Amount as authorized", "SELLER_FAVOR");
    // Readback sees only charges that carry this agreement's labels, so "no other charge" would be
    // inferred from silence: an unlabeled second charge is invisible to it (audit Oct 25). PayPal
    // sees every charge to the wallet, so this is PayPal's call.
    case "DUPLICATE_TRANSACTION":
      return row(9, "NO_OTHER_LABELED_CHARGE", "No other labeled charge in its period", null, [
        "Readback sees only charges labeled with this agreement; PayPal can see every charge to this wallet.",
      ]);
    // Until PayPal's cancellation record is readable (spike step 5: does a buyer-side cancel delete
    // the token, and when?), "charged before she cancelled" has no evidence behind it.
    case "CANCELED_RECURRING_BILLING":
      return row(10, "CANCELLATION_TIME_UNKNOWN", "In terms; the cancellation time isn't readable", null, [
        "Readback can't read when she cancelled; PayPal can.",
      ]);
    default: // UNAUTHORISED (and preview mode)
      if (any("10")) return row(11, "AUTHORIZED_NOT_FULFILLED", "Authorized by terms; fulfillment not shown", null);
      if (any("11")) return row(12, "CONSENT_UNVERIFIED", "Consent authenticity unverified", null, ["Route to PayPal account review."]);
      // What the evidence shows, not a motive: her approved key signed this, within her terms, with
      // undisputed history. Consent authenticity rests on that history and on the key bound at setup (T21).
      return row(13, "SIGNED_WITHIN_TERMS", "Signed by her approved agent, within her terms", "SELLER_FAVOR", [
        "Supported PayPal reason: NOT_AN_UNAUTHORIZED_TRANSACTION.",
      ]);
  }
}

// SPEC §5.6 modifiers. They only ever *withhold* a seller-favor suggestion, never create one:
// anything merchant-attested or still-lagging can't be what wins the merchant a case.
function applyModifiers(c: Classification, checks: CheckResult[], facts: CaseFacts): Classification {
  if (c.suggestion !== "SELLER_FAVOR") return c;
  // The history threshold guards every seller-favor row, not only "unauthorized": a valid signature
  // doesn't relax it, because whoever approved the agreement chose the key (T21; audit Oct 25).
  if (checks.some((k) => k.id === "11" && !k.pass)) {
    return { ...c, suggestion: null, notes: [...c.notes, "Too little undisputed history to rely on the approved key: no suggestion."] };
  }
  if (facts.secondaryTerms) {
    return { ...c, suggestion: null, notes: [...c.notes, "Terms merchant-attested only (agreement deleted): no suggestion."] };
  }
  if (checks.some((k) => k.provisional)) {
    return { ...c, suggestion: null, notes: [...c.notes, "Provisional: the charge is under 3 hours old and history may still be lagging."] };
  }
  return c;
}
