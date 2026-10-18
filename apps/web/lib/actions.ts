// Merchant write actions on a dispute (SPEC §5.5 steps 5–8). Sam approves a draft; this sends it.
// - Follows the dispute's own `links`: PayPal offers different actions in different states (spike
//   step 7 saw only provide_supporting_info under UNDER_PAYPAL_REVIEW), so nothing is assumed.
// - Reads evidences[]/messages[] first and skips text already on the case, and derives the
//   PayPal-Request-Id from the text, so a retry never double-submits.
import { z } from "zod";
import type { PayPalClient } from "@/lib/paypal/client";

export const ActionRequestSchema = z.object({
  action: z.enum(["send_message", "accept_claim", "provide_supporting_info", "provide_evidence"]),
  text: z.string().trim().min(1).max(2000),
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

const DisputeLinks = z.object({
  reason: z.string(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).default([]),
  evidences: z.array(z.object({ notes: z.string().optional() })).nullish(),
  messages: z.array(z.object({ content: z.string().optional() })).nullish(),
});

// Real enum values from customer_disputes_v1.json#/components/schemas/evidence (no PROOF_OF_AUTHORIZATION).
function evidenceType(reason: string): string {
  if (reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") return "PROOF_OF_FULFILLMENT";
  if (reason === "UNAUTHORISED") return "BILLING_AGREEMENT";
  return "OTHER";
}

export type ActionResult =
  | { ok: true; sent: boolean; message: string }
  | { ok: false; status: number; message: string };

export async function runDisputeAction(paypal: PayPalClient, disputeId: string, req: ActionRequest): Promise<ActionResult> {
  const path = `/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
  const got = await paypal.get(path, DisputeLinks);
  if (!got.ok) return { ok: false, status: got.status === 404 ? 404 : 502, message: "PayPal didn't return this dispute." };
  const d = got.data;

  if (!d.links.some((l) => l.rel === req.action)) {
    const offered = d.links.map((l) => l.rel).filter((r) => r !== "self");
    return { ok: false, status: 409, message: `PayPal doesn't offer this action on the dispute right now. It offers: ${offered.join(", ") || "nothing"}.` };
  }
  const already = [...(d.evidences ?? []).map((e) => e.notes), ...(d.messages ?? []).map((m) => m.content)];
  if (already.includes(req.text)) return { ok: true, sent: false, message: "Already on the case; nothing sent again." };

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
    res = await paypal.post(endpoint, requestId, req.action === "send_message" ? { message: req.text } : { note: req.text }, Any);
  }
  if (!res.ok) return { ok: false, status: 502, message: `PayPal refused: ${res.issues.join(", ")}.` };
  return { ok: true, sent: true, message: "Sent to PayPal." };
}
