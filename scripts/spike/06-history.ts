// Spike step 6, SPEC §8: can Readback find its own past charges in Transaction Search
// (SPEC §5.3a, §5.6 check 11) with no database of its own?
// Needs "Transaction Search" ticked on the sandbox app (developer.paypal.com > your app >
// Features), then a few minutes for the permission to apply. A 403 means it isn't on yet.
// Run: pnpm spike:history [--days=30]   (re-run ~3 h after step 3 to measure the lag)
import { parseArgs } from "node:util";
import { check, info, usage } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { paypal } from "./paypal.ts";

const { values } = parseArgs({ options: { days: { type: "string", default: "30" } }, strict: true });
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 31) usage("pnpm spike:history [--days=1..31]");

type Txn = {
  transaction_info: {
    transaction_id: string;
    transaction_initiation_date: string;
    transaction_updated_date?: string;
    transaction_amount?: { value: string };
    invoice_id?: string;
    custom_field?: string;
  };
};
type Search = { transaction_details?: Txn[]; total_pages?: number; last_refreshed_datetime?: string };

// PayPal caps one search at 31 days. toISOString() gives "2026-10-14T09:00:00.000Z", which the
// spec's date pattern accepts (fractional seconds and Z are both allowed).
const now = Date.now();
const start = new Date(now - days * 86_400_000).toISOString();
const end = new Date(now).toISOString();

const all: Txn[] = [];
let lastRefreshed: string | undefined;
// `fields=transaction_info` only: we need custom_field and dates, and it keeps payer PII out.
for (let page = 1; ; page++) {
  const q = new URLSearchParams({ start_date: start, end_date: end, fields: "transaction_info", page_size: "500", page: String(page) });
  const res = (await paypal({ method: "GET", path: `/v1/reporting/transactions?${q}` })) as Search;
  if (page === 1) saveFixture("06-transactions-page1", res);
  all.push(...(res.transaction_details ?? []));
  lastRefreshed = res.last_refreshed_datetime;
  if (page >= (res.total_pages ?? 1)) break;
}

// No server-side filter on custom_field exists, so filter here (SPEC §3 "History" row).
const ours = all.filter((t) => t.transaction_info.custom_field?.startsWith("rb1:"));
console.log(`\n${all.length} transactions in the last ${days} days, ${ours.length} with custom_field rb1:*`);
info(`last_refreshed_datetime (PayPal's own freshness stamp): ${lastRefreshed}`);
if (lastRefreshed) info(`  data is ${((now - Date.parse(lastRefreshed)) / 60_000).toFixed(0)} min behind now`);

if (ours.length === 0) {
  info("No rb1: charges yet. Expected if step 3 ran < 3 h ago (Transaction Search lag). Re-run later.");
} else {
  // SPEC §4.4 custom_id shape. If ':' were stripped or rewritten, this fails.
  const shape = /^rb1:[0-9A-Za-z_-]{1,36}:[0-9a-f]{16}:p\d{3}:[0-9a-f]{16}$/;
  check("every rb1: custom_field keeps ':' and the full SPEC §4.4 shape", ours.every((t) => shape.test(t.transaction_info.custom_field ?? "")));
  check("every rb1: match also carries invoice_id RB-...", ours.every((t) => t.transaction_info.invoice_id?.startsWith("RB-")));
  ours.sort((a, b) => b.transaction_info.transaction_initiation_date.localeCompare(a.transaction_info.transaction_initiation_date));
  for (const t of ours.slice(0, 10)) {
    const ti = t.transaction_info;
    console.log(`  ${ti.transaction_initiation_date}  ${ti.transaction_id}  ${ti.transaction_amount?.value}  ${ti.invoice_id}  ${ti.custom_field}`);
  }
  const newest = Date.parse(ours[0]!.transaction_info.transaction_initiation_date);
  info(`newest rb1: charge is ${((now - newest) / 60_000).toFixed(0)} min old. Compare with when step 3/4 ran to bound the lag.`);
}
