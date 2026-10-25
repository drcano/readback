// The investigator queue (SPEC §5.6): live sandbox disputes, each evaluated from PayPal's records,
// plus labeled fixture rows. Every row says where it came from.
import { type CaseBundle, evaluateCase, type Light, lights } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";
import { z } from "zod";
import { buildCaseBundle } from "./cases";
import { paypalRuling, type Ruling } from "./labels";
import type { PayPalClient } from "./paypal/client";

export type QueueRow = {
  id: string;
  href: string;
  source: "Live" | "Fixture";
  note: string;
  reason: string;
  stage: string;
  amount: number;
  due: string | null;
  classification: string;
  row: number;
  suggestion: "BUYER_FAVOR" | "SELLER_FAVOR" | null;
  ruling: Ruling | null; // PayPal's own outcome, once it has decided
  failed: string;
  lights: Light[];
  evidence: "PayPal terms" | "Merchant copy (secondary)";
};

async function toRow(id: string, href: string, source: QueueRow["source"], note: string, bundle: CaseBundle): Promise<QueueRow> {
  const r = await evaluateCase(bundle);
  return {
    id,
    href,
    source,
    note,
    reason: r.reason,
    stage: bundle.dispute?.dispute_life_cycle_stage ?? "preview",
    amount: Number(bundle.capture.amount.value),
    due: bundle.dispute?.seller_response_due_date ?? null,
    classification: r.classification.label,
    row: r.classification.row,
    suggestion: r.classification.suggestion,
    ruling: paypalRuling(bundle.dispute?.dispute_outcome, r.classification.suggestion),
    failed: r.failed.join(", "),
    lights: lights(r.checks),
    evidence: r.facts.secondaryTerms ? "Merchant copy (secondary)" : "PayPal terms",
  };
}

const DisputeList = z.object({ items: z.array(z.object({ dispute_id: z.string() })).optional() });

export async function buildQueue(paypal: PayPalClient | null, now: Date): Promise<{ rows: QueueRow[]; liveError: string | null }> {
  const rows: QueueRow[] = [];
  let liveError: string | null = null;
  if (!paypal) liveError = "PayPal isn't configured on this deployment; showing fixtures only.";
  else {
    const list = await paypal.get("/v1/customer/disputes?page_size=50", DisputeList);
    if (!list.ok) liveError = "Couldn't list disputes from PayPal; showing fixtures only.";
    else {
      for (const { dispute_id } of list.data.items ?? []) {
        const lookup = await buildCaseBundle(dispute_id, paypal, now);
        if (lookup.ok) rows.push(await toRow(dispute_id, `/investigator/${encodeURIComponent(dispute_id)}`, "Live", "Sandbox dispute", lookup.bundle));
      }
    }
  }
  for (const f of await fixtureCases()) {
    rows.push(await toRow(f.id, `/investigator/fixture-${f.id}`, "Fixture", f.label, f.bundle));
  }
  return { rows, liveError };
}
