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
  const classification = applyModifiers(classify(reason, new Set(failed)), checks, facts);
  return { mode, reason, facts, checks, failed, classification };
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
    case "DUPLICATE_TRANSACTION":
      return row(9, "SINGLE_CHARGE_IN_PERIOD", "Single charge in its period", "SELLER_FAVOR");
    case "CANCELED_RECURRING_BILLING":
      return row(10, "CHARGED_BEFORE_CANCELLATION", "Charged before cancellation", "SELLER_FAVOR");
    default: // UNAUTHORISED (and preview mode)
      if (any("10")) return row(11, "AUTHORIZED_NOT_FULFILLED", "Authorized by terms; fulfillment not shown", null);
      if (any("11")) return row(12, "CONSENT_UNVERIFIED", "Consent authenticity unverified", null, ["Route to PayPal account review."]);
      return row(13, "FIRST_PARTY_MISUSE", "First-party misuse", "SELLER_FAVOR", [
        "Supported PayPal reasons: NOT_AN_UNAUTHORIZED_TRANSACTION, CUSTOMER_RECOGNIZES_TRANSACTION.",
      ]);
  }
}

// SPEC §5.6 modifiers. They only ever *withhold* a seller-favor suggestion, never create one:
// anything merchant-attested or still-lagging can't be what wins the merchant a case.
function applyModifiers(c: Classification, checks: CheckResult[], facts: CaseFacts): Classification {
  if (c.suggestion !== "SELLER_FAVOR") return c;
  if (facts.secondaryTerms) {
    return { ...c, suggestion: null, notes: [...c.notes, "Terms merchant-attested only (agreement deleted): no suggestion."] };
  }
  if (checks.some((k) => k.provisional)) {
    return { ...c, suggestion: null, notes: [...c.notes, "Provisional: the charge is under 3 hours old and history may still be lagging."] };
  }
  return c;
}
