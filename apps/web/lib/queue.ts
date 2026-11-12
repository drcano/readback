// The investigator queue (SPEC §5.6): live sandbox disputes, each evaluated from PayPal's records,
// plus labeled fixture rows. Every row says where it came from.
import { type CaseBundle, evaluateCase, type Light, lights } from "@readbackhq/core";
import { fixtureCases } from "@readbackhq/core/fixtures";
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
  loaded: boolean; // false: PayPal couldn't be read for this dispute in time; no verdict is shown
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
    loaded: true,
  };
}

// A live dispute Readback couldn't evaluate: listed, never judged.
const unloaded = (d: ListedDispute, why: string): QueueRow => ({
  id: d.dispute_id, href: `/investigator/${encodeURIComponent(d.dispute_id)}`, source: "Live", note: why,
  reason: d.reason ?? "UNAUTHORISED", stage: d.dispute_life_cycle_stage ?? "", amount: Number(d.dispute_amount?.value ?? 0), due: null,
  classification: why, row: 0, suggestion: null, ruling: null, failed: "", lights: [], evidence: "PayPal terms", loaded: false,
});

// A dispute flood mustn't turn one page view into thousands of PayPal calls or a request that never
// ends (evals/flood.test.ts): cases are built a few at a time within a wall-clock budget, and every
// listed dispute appears, evaluated or honestly not (audit: flood, Oct 26).
const CONCURRENCY = 4;
const BUDGET_MS = 15_000;

const ListedDispute = z.object({
  dispute_id: z.string(),
  reason: z.string().optional(),
  dispute_life_cycle_stage: z.string().optional(),
  dispute_amount: z.object({ value: z.string() }).optional(),
});
type ListedDispute = z.infer<typeof ListedDispute>;
const DisputeList = z.object({ items: z.array(ListedDispute).optional(), links: z.array(z.object({ rel: z.string() })).optional() });

export async function buildQueue(paypal: PayPalClient | null, now: Date, budgetMs = BUDGET_MS): Promise<{ rows: QueueRow[]; liveError: string | null; notices: string[] }> {
  const rows: QueueRow[] = [];
  const notices: string[] = [];
  let liveError: string | null = null;
  if (!paypal) liveError = "PayPal isn't configured on this deployment; showing fixtures only.";
  else {
    const list = await paypal.get("/v1/customer/disputes?page_size=50", DisputeList);
    if (!list.ok) liveError = list.status === 429 ? "PayPal is rate-limiting requests; showing fixtures only. Try again in a minute." : "Couldn't list disputes from PayPal; showing fixtures only.";
    else {
      const listed = list.data.items ?? [];
      if (list.data.links?.some((l) => l.rel === "next")) notices.push(`Showing the ${listed.length} most recent disputes; PayPal has more.`);
      const deadline = Date.now() + budgetMs;
      const out: QueueRow[] = new Array(listed.length);
      let next = 0;
      const worker = async () => {
        while (next < listed.length) {
          const i = next++;
          const d = listed[i]!;
          if (Date.now() > deadline) {
            out[i] = unloaded(d, "Not loaded within the time limit; open it to load.");
            continue;
          }
          const lookup = await buildCaseBundle(d.dispute_id, paypal, now);
          out[i] = lookup.ok ? await toRow(d.dispute_id, `/investigator/${encodeURIComponent(d.dispute_id)}`, "Live", "Sandbox dispute", lookup.bundle) : unloaded(d, lookup.message);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      rows.push(...out);
      const missing = out.filter((r) => !r.loaded).length;
      if (missing) notices.push(`${missing} of ${listed.length} live disputes couldn't be evaluated from PayPal just now; they're listed without a verdict.`);
    }
  }
  for (const f of await fixtureCases()) {
    rows.push(await toRow(f.id, `/investigator/fixture-${f.id}`, "Fixture", f.label, f.bundle));
  }
  return { rows, liveError, notices };
}
