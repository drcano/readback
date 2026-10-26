// The eleven checks (SPEC §5.6). Every one reads only PayPal objects, the approved terms, and a
// signature by the approved agent key. Nothing the merchant or Claude asserts decides a check
// (THREAT-MODEL "design rule"); merchant-attested inputs are labeled where they're used.
import type { Address, CaseBundle } from "./case.ts";
import { sha256Hex } from "./hash.ts";
import { agreementFromLabels, invoiceId, parseCustomId, parseInvoiceId } from "./ids.ts";
import { CLOCK_SKEW_SEC, type VerifiedMandate, verifyMandate } from "./mandate.ts";
import { formatCents, parseCents } from "./money.ts";
import type { Failure } from "./result.ts";
import { parseTerms, periodIndex, type Terms, withinDates } from "./terms.ts";

export type CheckId = "1" | "2a" | "2b" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11";
export type CheckGroup = "Consent" | "Agent" | "Terms" | "Delivery";

export type CheckResult = {
  id: CheckId;
  group: CheckGroup;
  name: string;
  pass: boolean;
  failures: Failure[]; // empty when pass
  provisional: boolean; // depends on Transaction Search data that may still be lagging
  secondary: boolean; // relied on the merchant-written copy of the terms
};

// A stated policy constant (SPEC §5.6): ≥2 prior undisputed captures, the earliest ≥7 days before.
export const HISTORY_MIN_PRIOR = 2;
export const HISTORY_MIN_AGE_SEC = 7 * 86_400;
export const SEARCH_LAG_SEC = 3 * 3_600; // Transaction Search can lag up to 3 hours

const COMPLETED_CAPTURE = new Set(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);
const ZERO_BREAKDOWN = ["shipping", "handling", "tax_total", "insurance", "shipping_discount", "discount"] as const;
const ADDRESS_FIELDS = ["address_line_1", "address_line_2", "admin_area_2", "admin_area_1", "postal_code", "country_code"] as const;

const toSec = (iso: string): number => Date.parse(iso) / 1000;

// Everything the checks share, derived once from the bundle.
export type CaseFacts = {
  tokenId: string | null; // PayPal's vault echo if present, else the agreement both labels name
  echoed: boolean; // tokenId came from PayPal itself, not from the labels
  terms: Terms | null;
  termsText: string | null;
  termsHash: string | null;
  secondaryTerms: boolean;
  mandate: VerifiedMandate | null;
  mandateFailure: Failure | null;
  captureSec: number;
  provisional: boolean;
};

export async function deriveFacts(b: CaseBundle): Promise<CaseFacts> {
  const pu = b.order.purchase_units[0]!;
  const echo = b.order.payment_source?.paypal?.attributes?.vault?.id ?? null;
  const tokenId = echo ?? agreementFromLabels(pu.custom_id, pu.invoice_id);
  // Primary terms come from PayPal's token. Only if the token is GONE (deleted) do we fall back to
  // the copy the merchant wrote onto the charge, labeled secondary (THREAT-MODEL T10). A token that
  // exists but carries no terms is "no terms": the merchant's copy must never stand in for PayPal's.
  const termsText = b.token ? (b.token.payment_source.paypal.description ?? null) : (pu.description ?? null);
  const parsed = termsText === null ? null : parseTerms(termsText);
  const jws = pu.items?.[0]?.description;
  const verified = jws ? await verifyMandate(jws) : null;
  const captureSec = toSec(b.capture.create_time);
  return {
    tokenId,
    echoed: echo !== null,
    terms: parsed?.ok ? parsed.value : null,
    termsText,
    termsHash: termsText === null ? null : await sha256Hex(termsText),
    secondaryTerms: b.token === null,
    mandate: verified?.ok ? verified.value : null,
    mandateFailure: verified === null ? { code: "NO_MANDATE", message: "The charge carries no signed request from an agent." } : verified.ok ? null : verified.error,
    captureSec,
    // Provisional if history may be lagging (capture under 3 hours old) or the search was incomplete.
    provisional: toSec(b.now) - captureSec < SEARCH_LAG_SEC || !b.historyComplete,
  };
}

type Draft = { failures: Failure[]; provisional?: boolean; secondary?: boolean };
const f = (code: string, message: string): Failure => ({ code, message });

export async function runChecks(b: CaseBundle): Promise<{ facts: CaseFacts; checks: CheckResult[] }> {
  const facts = await deriveFacts(b);
  const { tokenId, terms, mandate } = facts;
  const pu = b.order.purchase_units[0]!;
  const item = pu.items?.[0];
  const sig = mandate?.payload;
  const orderPayer = b.order.payer?.payer_id ?? b.order.payment_source?.paypal?.account_id;
  const otherCaptures = b.history.filter((h) => h.captureId !== b.capture.id);

  const drafts: [CheckId, CheckGroup, string, () => Draft][] = [
    ["1", "Consent", "Consent on PayPal", () => {
      const out: Failure[] = [];
      if (facts.termsText === null) out.push(f("NO_TERMS", "No approved terms were found for this charge."));
      else if (!terms) out.push(f("TERMS_UNREADABLE", "The approved terms can't be read."));
      if (b.token) {
        const tokenPayer = b.token.payment_source.paypal.payer_id;
        if (!tokenPayer || tokenPayer !== orderPayer) out.push(f("PAYER_MISMATCH", "The agreement was approved by a different PayPal account than the one charged."));
      } else if (tokenId === null) {
        out.push(f("NO_AGREEMENT", "PayPal shows no saved agreement behind this charge."));
      }
      return { failures: out, secondary: facts.secondaryTerms };
    }],

    ["2a", "Consent", "Agreement link", () => {
      if (tokenId === null) return { failures: [f("NO_AGREEMENT_LINK", "Nothing links this charge to a saved agreement.")] };
      if (b.token && b.token.id !== tokenId) return { failures: [f("VAULT_MISMATCH", "PayPal shows a different agreement paid for this charge.")] };
      // Without PayPal's echo the link rests on the labels plus PayPal's payer match (check 1). If the
      // agreement is gone, the payer can't be matched: the link stands only as secondary evidence,
      // which can count against the merchant but never for it (no seller-favor suggestion).
      return { failures: [], secondary: !facts.echoed && !b.token };
    }],

    ["2b", "Agent", "Labels present", () => {
      const cid = pu.custom_id ? parseCustomId(pu.custom_id) : null;
      const inv = pu.invoice_id ? parseInvoiceId(pu.invoice_id) : null;
      const out: Failure[] = [];
      if (!cid || cid.tokenId !== tokenId) out.push(f("CUSTOM_ID_INVALID", "The charge's Readback reference is missing or names another agreement."));
      if (!inv || inv.tokenId !== tokenId) out.push(f("INVOICE_ID_INVALID", "The charge's period invoice number is missing or names another agreement."));
      if (cid && inv && cid.period !== inv.period) out.push(f("LABELS_DISAGREE", "The charge's reference and invoice number name different periods."));
      if (cid && mandate && cid.mandateHash16 !== mandate.mandateHash.slice(0, 16)) {
        out.push(f("LABELS_DISAGREE", "The charge's reference points at a different signed request."));
      }
      // The capture carries its own copy of the labels; it must agree with the order's.
      if (b.capture.custom_id !== undefined && b.capture.custom_id !== pu.custom_id) out.push(f("LABELS_DISAGREE", "The capture's reference differs from the order's."));
      if (b.capture.invoice_id !== undefined && b.capture.invoice_id !== pu.invoice_id) out.push(f("LABELS_DISAGREE", "The capture's invoice number differs from the order's."));
      return { failures: out };
    }],

    ["3", "Agent", "Requested by her agent", () => {
      if (!mandate || !sig) return { failures: [facts.mandateFailure!] };
      const out: Failure[] = [];
      if (!terms || mandate.fingerprint !== terms.fingerprint) out.push(f("KEY_NOT_APPROVED", "It wasn't signed by the agent key approved on PayPal."));
      if (sig.agr !== tokenId) out.push(f("WRONG_AGREEMENT", "The signed request names a different agreement."));
      // Money as integer cents, never as strings; a non-canonical amount parses to null and differs.
      if (!item || sig.sku !== item.sku || String(sig.qty) !== item.quantity || !sameCents(sig.unit, item.unit_amount.value)) {
        out.push(f("ORDER_DIFFERS", "The order's item doesn't match the signed request."));
      }
      if (!sameCents(sig.amt, pu.amount.value)) out.push(f("ORDER_DIFFERS", "The order's total doesn't match the signed request."));
      const inv = pu.invoice_id ? parseInvoiceId(pu.invoice_id) : null;
      if (!inv || inv.period !== sig.p) out.push(f("ORDER_DIFFERS", "The order's period doesn't match the signed request."));
      // The gate accepts iat up to one skew ahead of its own clock, and PayPal's clock may be one skew
      // behind the gate's: the earliest honest capture is two skews before iat (audit Oct 25, T27).
      // The gate stops one skew before exp, so the latest honest capture is within one skew after it.
      if (facts.captureSec < sig.iat - 2 * CLOCK_SKEW_SEC || facts.captureSec > sig.exp + CLOCK_SKEW_SEC) {
        out.push(f("CAPTURED_OUTSIDE_WINDOW", "The charge happened outside the signed request's five-minute window."));
      }
      const reused = otherCaptures.some((h) => h.customId && parseCustomId(h.customId)?.mandateHash16 === mandate.mandateHash.slice(0, 16));
      if (reused) out.push(f("MANDATE_REUSED", "The same signed request was used for another charge."));
      return { failures: out, provisional: facts.provisional };
    }],

    ["4", "Consent", "Active at charge", () => {
      const out: Failure[] = [];
      if (tokenId === null) out.push(f("NO_AGREEMENT_LINK", "Nothing links this charge to a saved agreement."));
      // An open dispute turns the capture PENDING with reason BUYER_COMPLAINT (spike step 7): the
      // money moved, the dispute is holding it. Every disputed charge looks like this.
      const disputeHold = b.capture.status === "PENDING" && b.capture.status_details?.reason === "BUYER_COMPLAINT";
      if (!COMPLETED_CAPTURE.has(b.capture.status) && !disputeHold) out.push(f("CAPTURE_NOT_COMPLETED", "PayPal didn't complete this charge."));
      if (b.tokenDeletedAt !== null && toSec(b.tokenDeletedAt) <= facts.captureSec) {
        out.push(f("CHARGED_AFTER_REVOCATION", "The charge happened after the agreement was cancelled."));
      }
      return { failures: out };
    }],

    ["5", "Terms", "Within cap", () => {
      const out: Failure[] = [];
      const amount = pu.amount.currency_code === "USD" ? parseCents(pu.amount.value) : null;
      const captured = b.capture.amount.currency_code === "USD" ? parseCents(b.capture.amount.value) : null;
      if (amount === null || captured === null || !terms) return { failures: [f("AMOUNT_UNREADABLE", "The charge amount can't be compared with the terms.")], secondary: facts.secondaryTerms };
      if (amount > terms.capCents) out.push(f("OVER_CAP", `USD ${pu.amount.value} is over the approved USD ${formatCents(terms.capCents)} per order.`));
      if (captured !== amount) out.push(f("CAPTURE_DIFFERS", "The amount captured differs from the order."));
      if (sig && parseCents(sig.amt) !== amount) out.push(f("AMOUNT_NOT_SIGNED", "The amount differs from what the agent signed."));
      const bd = pu.amount.breakdown;
      if (!bd?.item_total || parseCents(bd.item_total.value) !== amount) out.push(f("BREAKDOWN_INVALID", "The order's item total doesn't equal its amount."));
      for (const k of ZERO_BREAKDOWN) {
        const v = bd?.[k];
        if (v && parseCents(v.value) !== 0) out.push(f("UNSIGNED_EXTRAS", `The order adds ${k.replace("_", " ")}, which nobody signed.`));
      }
      return { failures: out, secondary: facts.secondaryTerms };
    }],

    ["6", "Terms", "Approved item", () => {
      const out: Failure[] = [];
      if (!terms || !item || (pu.items?.length ?? 0) !== 1) return { failures: [f("ITEM_UNREADABLE", "The order doesn't contain exactly one item to compare.")], secondary: facts.secondaryTerms };
      if (item.sku !== terms.sku) out.push(f("SKU_NOT_APPROVED", `The order is for ${item.sku ?? "an unnamed item"}, not the approved ${terms.sku}.`));
      if (!/^[1-9]\d{0,2}$/.test(item.quantity) || Number(item.quantity) > terms.qty) out.push(f("QTY_OVER_LIMIT", `The approved limit is ${terms.qty} per order.`));
      if (sig && (sig.sku !== item.sku || String(sig.qty) !== item.quantity)) out.push(f("ITEM_NOT_SIGNED", "The item differs from what the agent signed."));
      return { failures: out, secondary: facts.secondaryTerms };
    }],

    ["7", "Terms", "One per period", () => {
      if (!terms || tokenId === null) return { failures: [f("PERIOD_UNKNOWN", "The charge's period can't be established.")], secondary: facts.secondaryTerms };
      const out: Failure[] = [];
      // With a signed request, the period is the signed one and the invoice must be canonical.
      // Without one, the period comes from PayPal's capture time, and the missing labels are
      // already check 2b's failure: this check stays about the terms themselves.
      const p = sig ? periodIndex(sig.iat, terms) : periodIndex(facts.captureSec, terms);
      if (sig && (p === null || p !== sig.p || p > 999)) out.push(f("WRONG_PERIOD", "The signed period isn't the period it was signed in."));
      else if (sig && pu.invoice_id !== invoiceId(tokenId, p!)) out.push(f("INVOICE_NOT_CANONICAL", "The invoice number isn't the canonical one for this period."));
      if (p === null) out.push(f("OUTSIDE_DATES", "The charge happened before the agreement started."));
      // This must be the earliest charge of its period. While PayPal's duplicate-invoice blocking
      // is on it can't be otherwise for labeled charges; it matters for unlabeled ones.
      const earlierSamePeriod = otherCaptures.some(
        (h) => h.customId && parseCustomId(h.customId)?.period === p && toSec(h.captureTime) < facts.captureSec,
      );
      if (earlierSamePeriod) out.push(f("NOT_FIRST_IN_PERIOD", "Another charge was already made in this period."));
      return { failures: out, secondary: facts.secondaryTerms, provisional: facts.provisional };
    }],

    ["8", "Terms", "Within dates", () => {
      if (!terms) return { failures: [f("TERMS_UNREADABLE", "The approved dates can't be read.")], secondary: facts.secondaryTerms };
      const out: Failure[] = [];
      if (sig && !withinDates(sig.iat, terms)) out.push(f("OUTSIDE_DATES", `The request was signed outside ${terms.start} to ${terms.end}.`));
      if (!withinDates(facts.captureSec, terms)) out.push(f("OUTSIDE_DATES", `The charge happened outside ${terms.start} to ${terms.end}.`));
      return { failures: out, secondary: facts.secondaryTerms };
    }],

    ["9", "Terms", "Bound to these terms", () => {
      if (!facts.termsHash) return { failures: [f("NO_TERMS", "No approved terms to bind to.")], secondary: facts.secondaryTerms };
      const th16 = facts.termsHash.slice(0, 16);
      const out: Failure[] = [];
      if (sig && sig.th !== th16) out.push(f("TERMS_HASH_MISMATCH", "The agent signed different terms."));
      const cid = pu.custom_id ? parseCustomId(pu.custom_id) : null;
      // A missing reference is check 2b's failure; a reference naming other terms is this one's.
      if (cid && cid.termsHash16 !== th16) out.push(f("TERMS_HASH_MISMATCH", "The charge's reference names different terms."));
      if (pu.description !== facts.termsText) out.push(f("TERMS_COPY_DIFFERS", "The terms copied onto the charge differ from the approved terms."));
      return { failures: out, secondary: facts.secondaryTerms };
    }],

    ["10", "Delivery", "Fulfilled (merchant-reported)", () => {
      const out: Failure[] = [];
      // PayPal moves a tracked shipment from SHIPPED to DELIVERED; both mean it was sent (audit Oct 25).
      if (!pu.shipping?.trackers?.some((t) => t.status === "SHIPPED" || t.status === "DELIVERED")) out.push(f("NOT_SHIPPED", "No shipment was reported for this order."));
      const approved = b.token?.payment_source.paypal.shipping?.address;
      if (approved && !pu.shipping?.address) out.push(f("NO_ADDRESS", "The order carries no shipping address."));
      else if (approved && !sameAddress(approved, pu.shipping?.address)) out.push(f("ADDRESS_DIFFERS", "It shipped to a different address than the one approved."));
      return { failures: out };
    }],

    ["11", "Delivery", "History", () => {
      // Only PayPal-verified captures under this agreement count; labeled-but-unverified ones don't.
      const prior = otherCaptures.filter((h) => h.verified && toSec(h.captureTime) < facts.captureSec && !h.disputed);
      const earliest = Math.min(...prior.map((h) => toSec(h.captureTime)));
      const ok = prior.length >= HISTORY_MIN_PRIOR && facts.captureSec - earliest >= HISTORY_MIN_AGE_SEC;
      return {
        failures: ok ? [] : [f("HISTORY_BELOW_THRESHOLD", `${prior.length} earlier undisputed charge(s) under this agreement; at least ${HISTORY_MIN_PRIOR} over 7+ days are needed.`)],
        provisional: facts.provisional,
      };
    }],
  ];

  const checks = drafts.map(([id, group, name, run]) => {
    const d = run();
    return { id, group, name, pass: d.failures.length === 0, failures: d.failures, provisional: d.provisional ?? false, secondary: d.secondary ?? false };
  });
  return { facts, checks };
}

function sameCents(a: string, b: string): boolean {
  const x = parseCents(a);
  return x !== null && x === parseCents(b);
}

function sameAddress(a: Address, b: Address | undefined): boolean {
  return b !== undefined && ADDRESS_FIELDS.every((k) => (a[k] ?? "") === (b[k] ?? ""));
}
