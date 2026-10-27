// Merchant write actions on a dispute (SPEC §5.5 steps 5–8). Sam approves a draft; this sends it.
// - Follows the dispute's own `links`: PayPal offers different actions in different states (spike
//   step 7 saw only provide_supporting_info under UNDER_PAYPAL_REVIEW), so nothing is assumed.
// - Reads evidences[]/messages[] first and skips text already on the case, and derives the
//   PayPal-Request-Id from the text, so a retry never double-submits.
import { evaluateCase } from "@readback/core";
import { z } from "zod";
import { buildCaseBundle } from "./cases";
import { evidenceStatement } from "./evidence";
import type { PayPalClient } from "./paypal/client";

export const ActionRequestSchema = z.union([
  z.object({
    action: z.enum(["send_message", "accept_claim", "provide_supporting_info", "provide_evidence"]),
    text: z.string().trim().min(1).max(2000),
  }),
  // Readback's evidence statement: the server rebuilds it from PayPal at send time; no text from the browser.
  z.strictObject({ action: z.literal("send_evidence") }),
  // Accept the claim with a full refund; the note is written by code from the case (Oct 26).
  z.strictObject({ action: z.literal("refund_buyer") }),
]);
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

const DisputeLinks = z.object({
  reason: z.string(),
  status: z.string().optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).default([]),
  evidences: z.array(z.object({ notes: z.string().optional() })).nullish(),
  supporting_info: z.array(z.object({ notes: z.string().optional() })).nullish(),
  messages: z.array(z.object({ content: z.string().optional() })).nullish(),
});
type DisputeRecord = z.infer<typeof DisputeLinks>;
const onRecord = (d: DisputeRecord) => [...(d.evidences ?? []).map((e) => e.notes), ...(d.supporting_info ?? []).map((s) => s.notes), ...(d.messages ?? []).map((m) => m.content)];

// Real enum values from customer_disputes_v1.json#/components/schemas/evidence (no PROOF_OF_AUTHORIZATION).
function evidenceType(reason: string): string {
  if (reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") return "PROOF_OF_FULFILLMENT";
  if (reason === "UNAUTHORISED" || reason === "CANCELED_RECURRING_BILLING") return "BILLING_AGREEMENT";
  if (reason === "INCORRECT_AMOUNT" || reason === "DUPLICATE_TRANSACTION") return "ORDER_DETAILS";
  return "OTHER";
}

export type ActionResult =
  | { ok: true; sent: boolean; message: string; via?: string; onPayPalRecord?: boolean }
  | { ok: false; status: number; message: string };

export async function runDisputeAction(paypal: PayPalClient, disputeId: string, req: ActionRequest, now = new Date()): Promise<ActionResult> {
  const path = `/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
  const got = await paypal.get(path, DisputeLinks);
  if (!got.ok) return { ok: false, status: got.status === 404 ? 404 : 502, message: "PayPal didn't return this dispute." };
  const d = got.data;

  if (req.action === "refund_buyer") {
    if (d.status === "RESOLVED") return { ok: true, sent: false, message: "PayPal has already resolved this dispute; nothing sent." };
    const lookup = await buildCaseBundle(disputeId, paypal, now);
    if (!lookup.ok) return { ok: false, status: lookup.status, message: lookup.message };
    // PayPal refunds as soon as the claim is accepted, then closes the dispute minutes later (spike step 7).
    if (lookup.bundle.capture.status === "REFUNDED") return { ok: true, sent: false, message: "PayPal shows this charge already refunded in full; nothing sent." };
    const r = await evaluateCase(lookup.bundle);
    const why = r.checks.find((k) => !k.pass)?.failures[0]?.message;
    const text = [
      // accept-claim refunds the disputed amount, which can differ from the capture (several charges, part disputed).
      "The store accepts this claim and refunds the disputed amount in full.",
      `Readback's assessment of PayPal's records: ${r.classification.label}${r.classification.suggestion === "BUYER_FAVOR" ? ", which supports the buyer" : ""}.${why ? ` ${why}` : ""}`,
      `Re-derive it with the store's API credentials: npx @readback/verify ${disputeId}`,
    ].join(" ");
    const sent = await runDisputeAction(paypal, disputeId, { action: "accept_claim", text }, now);
    return sent.ok && sent.sent ? { ...sent, via: "accept_claim", message: "Claim accepted; PayPal refunds the buyer." } : sent;
  }

  if (req.action === "send_evidence") {
    // Whichever evidence action PayPal offers in the dispute's current state (spike step 7).
    const action = d.links.some((l) => l.rel === "provide_evidence") ? "provide_evidence" : "provide_supporting_info";
    const lookup = await buildCaseBundle(disputeId, paypal, now);
    if (!lookup.ok) return { ok: false, status: lookup.status, message: lookup.message };
    const text = evidenceStatement(lookup.bundle, await evaluateCase(lookup.bundle));
    // Checked before the links: once evidence is in, PayPal stops offering provide_evidence (spike step 7).
    if (onRecord(d).includes(text)) return { ok: true, sent: false, message: "Already on PayPal's record of the dispute; nothing sent again.", onPayPalRecord: true };
    const sent = await runDisputeAction(paypal, disputeId, { action, text }, now);
    if (!sent.ok || !sent.sent) return sent;
    // Read it back: the statement should now be on PayPal's own record of the dispute.
    const after = await paypal.get(path, DisputeLinks);
    const landed = after.ok && onRecord(after.data).includes(text);
    return { ...sent, via: action, onPayPalRecord: landed, message: landed ? "Sent, and it's on PayPal's record of the dispute." : "Sent; PayPal accepted it but hasn't shown it on the dispute yet." };
  }

  // The record before the links: once PayPal has a response, it stops offering that action.
  if (onRecord(d).includes(req.text)) return { ok: true, sent: false, message: "Already on the case; nothing sent again.", onPayPalRecord: true };
  if (!d.links.some((l) => l.rel === req.action)) {
    const offered = d.links.map((l) => l.rel).filter((r) => r !== "self");
    return { ok: false, status: 409, message: `PayPal doesn't offer this action on the dispute right now. It offers: ${offered.join(", ") || "nothing"}.` };
  }

  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(req.text))), (b) => b.toString(16).padStart(2, "0")).join("");
  const requestId = `rb-${req.action}-${disputeId}-${hash.slice(0, 16)}`;
  const endpoint = `${path}/${req.action.replaceAll("_", "-")}`;
  const Any = z.unknown();

  let res;
  if (req.action === "provide_evidence" || req.action === "provide_supporting_info") {
    const input = req.action === "provide_evidence" ? { evidences: [{ evidence_type: evidenceType(d.reason), notes: req.text }] } : { notes: req.text };
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
    res = await paypal.postForm(endpoint, requestId, form, Any);
  } else {
    res = await paypal.post(endpoint, requestId, req.action === "send_message" ? { message: req.text } : { note: req.text, accept_claim_type: "REFUND" }, Any);
  }
  if (!res.ok) return { ok: false, status: 502, message: `PayPal refused: ${res.issues.join(", ")}.` };
  return { ok: true, sent: true, message: "Sent to PayPal." };
}
