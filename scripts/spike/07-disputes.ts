// Spike step 7, SPEC §8: drive real sandbox disputes through the Disputes v1 API and record
// what PayPal shows at each stage. Disputes can't be created by API: Maya opens them in the UI
// (run with no arguments for the steps).
// Run: pnpm spike:disputes                                   list recent disputes + how to open one
//      pnpm spike:disputes get <disputeId>                   read it and follow it to capture/order/token
//      pnpm spike:disputes escalate <disputeId>              INQUIRY -> claim
//      pnpm spike:disputes require-evidence <disputeId> [SELLER_EVIDENCE|BUYER_EVIDENCE]  (sandbox only)
//      pnpm spike:disputes provide-evidence <disputeId> [--type=X] [--file-part=evidence-file] [--input-as-string]
//      pnpm spike:disputes adjudicate <disputeId> SELLER_FAVOR|BUYER_FAVOR                (sandbox only)
//      pnpm spike:disputes send-message <disputeId> "text"  (INQUIRY stage only)
import { parseArgs } from "node:util";
import { check, info, TRACKING, usage, type Order } from "./common.ts";
import { saveFixture } from "./fixtures.ts";
import { issues, paypal, paypalRaw, type PayPalResponse } from "./paypal.ts";

// A valid 1x1 PNG (70 bytes): a real image file for the upload without an image library.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const HELP = `pnpm spike:disputes [list | get <id> | escalate <id> | require-evidence <id> [SELLER_EVIDENCE|BUYER_EVIDENCE]
  | provide-evidence <id> [--type=X] [--file-part=evidence-file] [--input-as-string]
  | adjudicate <id> SELLER_FAVOR|BUYER_FAVOR | send-message <id> "text"]`;

const { positionals, values } = parseArgs({
  options: {
    type: { type: "string" },
    "file-part": { type: "string", default: "evidence-file" },
    "input-as-string": { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});
const [action = "list", disputeId, extra] = positionals;
if (action !== "list" && !/^PP-[0-9A-Z-]+$/.test(disputeId ?? "")) usage(HELP);
const id = disputeId ?? "";

type Dispute = {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_life_cycle_stage: string;
  dispute_channel?: string;
  create_time?: string;
  seller_response_due_date?: string;
  dispute_amount?: { value: string };
  disputed_transactions?: { seller_transaction_id?: string; custom?: string; invoice_number?: string }[];
  evidences?: { evidence_type?: string; source?: string }[];
  messages?: { posted_by?: string; time_posted?: string }[];
  adjudications?: { type?: string; reason?: string; adjudication_time?: string }[];
  dispute_outcome?: { outcome_code?: string };
  allowed_response_options?: unknown;
  links?: { rel: string; method?: string }[];
};

async function getDispute(label: string): Promise<Dispute> {
  const d = (await paypal({ method: "GET", path: `/v1/customer/disputes/${id}` })) as Dispute;
  saveFixture(`07-${label}`, d);
  console.log(`\n${d.dispute_id}: reason ${d.reason} | stage ${d.dispute_life_cycle_stage} | status ${d.status} | channel ${d.dispute_channel}`);
  console.log(`  evidences ${d.evidences?.length ?? 0}, messages ${d.messages?.length ?? 0}, due ${d.seller_response_due_date ?? "-"}`);
  for (const a of d.adjudications ?? []) console.log(`  adjudication ${a.type} reason ${a.reason} at ${a.adjudication_time}`);
  if (d.dispute_outcome) console.log(`  outcome ${d.dispute_outcome.outcome_code}`);
  console.log(`  links: ${(d.links ?? []).map((l) => l.rel).join(", ")}`);
  console.log(`  allowed_response_options: ${JSON.stringify(d.allowed_response_options)}`);
  return d;
}

// HATEOAS: PayPal lists the actions it will accept right now as links. Rel names aren't in the
// OpenAPI spec, so match loosely ("provide-evidence" vs "provide_evidence") and just report.
function linkFor(d: Dispute, act: string): void {
  const want = act.replace(/-/g, "_");
  const has = (d.links ?? []).some((l) => l.rel.replace(/-/g, "_") === want);
  info(`'${act}' link offered by PayPal before the call: ${has ? "yes" : "no"}`);
}

function show(label: string, r: PayPalResponse): void {
  saveFixture(`07-${label}-response`, r.json);
  console.log(`${label}: HTTP ${r.status}, debug_id ${r.debugId}${r.ok ? "" : `\n${JSON.stringify(r.json, null, 2)}`}`);
  check(`${label} accepted (issues: ${issues(r.json).join(", ") || "none"})`, r.ok);
}

const post = (act: string, body: unknown) =>
  paypalRaw({ method: "POST", path: `/v1/customer/disputes/${id}/${act}`, requestId: `rb-spike07-${act}-${id}`, body });

switch (action) {
  case "list": {
    type List = { items?: { dispute_id: string; reason: string; status: string; create_time: string; dispute_amount?: { value: string } }[] };
    const list = (await paypal({ method: "GET", path: "/v1/customer/disputes?page_size=20" })) as List;
    saveFixture("07-disputes-list", list);
    for (const d of list.items ?? []) console.log(`  ${d.dispute_id}  ${d.create_time}  ${d.reason}  ${d.status}  $${d.dispute_amount?.value}`);
    console.log(`
To open a dispute (manual, one per charge from step 3/4):
  1. https://www.sandbox.paypal.com > log in as MAYA (sandbox PERSONAL account)
  2. Resolution Center (https://www.sandbox.paypal.com/resolutioncenter) > Report a problem
  3. Pick the Good Boy Provisions $64.99 payment.
     - "I don't recognize / didn't authorize" -> UNAUTHORISED
     - "I didn't receive an item I paid for"   -> MERCHANDISE_OR_SERVICE_NOT_RECEIVED
  4. Re-run this command; the new PP-D-... ID appears above (can take a minute).
Buyer cancellation test: as MAYA, open the dispute in the Resolution Center > Cancel/close it,
then 'get' it and record status + dispute_outcome.`);
    break;
  }

  case "get": {
    const d = await getDispute("dispute-get");
    // SPEC §5.5 step 2: dispute -> capture -> order -> token, using only PayPal's own links.
    for (const t of d.disputed_transactions ?? []) {
      console.log(`  seller_transaction_id ${t.seller_transaction_id}, custom ${t.custom}, invoice_number ${t.invoice_number}`);
      if (!t.seller_transaction_id) { check("seller_transaction_id present", false); continue; }
      type Capture = { custom_id?: string; invoice_id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
      const cap = (await paypal({ method: "GET", path: `/v2/payments/captures/${t.seller_transaction_id}` })) as Capture;
      saveFixture("07-capture", cap);
      check("dispute.custom === capture.custom_id", t.custom === cap.custom_id);
      check("dispute.invoice_number === capture.invoice_id", t.invoice_number === cap.invoice_id);
      const orderId = cap.supplementary_data?.related_ids?.order_id;
      check("capture -> order_id", orderId !== undefined);
      if (orderId) {
        const order = (await paypal({ method: "GET", path: `/v2/checkout/orders/${orderId}` })) as Order;
        saveFixture("07-order", order);
        const vaultId = order.payment_source?.paypal?.attributes?.vault?.id;
        check(`order -> vault.id (token ${vaultId ?? "missing"})`, vaultId !== undefined);
        check("custom_id names that token", cap.custom_id?.startsWith(`rb1:${vaultId}:`) === true);
      }
    }
    break;
  }

  case "escalate": {
    linkFor(await getDispute("before-escalate"), action);
    show("escalate", await post(action, { note: "Readback spike: escalating to a claim to test the evidence flow." }));
    await getDispute("after-escalate");
    break;
  }

  case "require-evidence": {
    // Sandbox-only helper: moves the case to WAITING_FOR_SELLER_RESPONSE, the only status
    // where the merchant may provide-evidence.
    const who = extra ?? "SELLER_EVIDENCE";
    if (who !== "SELLER_EVIDENCE" && who !== "BUYER_EVIDENCE") usage(HELP);
    linkFor(await getDispute("before-require-evidence"), action);
    show("require-evidence", await post(action, { action: who }));
    const after = await getDispute("after-require-evidence");
    check(`status WAITING_FOR_SELLER_RESPONSE (got ${after.status})`, who !== "SELLER_EVIDENCE" || after.status === "WAITING_FOR_SELLER_RESPONSE");
    break;
  }

  case "provide-evidence": {
    const before = await getDispute("before-provide-evidence");
    linkFor(before, action);
    // SPEC §5.5 step 5: look at what's already there so a retry never double-submits.
    info(`evidences already on the case: ${JSON.stringify(before.evidences?.map((e) => `${e.source}:${e.evidence_type}`) ?? [])}`);

    // Real enum values from customer_disputes_v1.json#/components/schemas/evidence.
    const type = values.type ?? (before.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" ? "PROOF_OF_FULFILLMENT" : before.reason === "UNAUTHORISED" ? "BILLING_AGREEMENT" : "OTHER");
    if (!/^[A-Z_]+$/.test(type)) usage(HELP);
    const evidence = {
      evidence_type: type,
      notes: "Readback spike: the buyer approved this agreement on PayPal and her agent signed this order. See attached.",
      ...(type === "PROOF_OF_FULFILLMENT"
        ? { evidence_info: { tracking_info: [{ carrier_name: TRACKING.carrier, tracking_number: TRACKING.number }] } }
        : {}),
    };
    const input = JSON.stringify({ evidences: [evidence] });

    // The OpenAPI spec only names the file part ("evidence-file"); the JSON part name "input"
    // comes from PayPal's docs. Node's FormData always gives a Blob part a filename, so
    // --input-as-string sends `input` as a plain text field instead, in case PayPal objects.
    const form = new FormData();
    form.append("input", values["input-as-string"] ? input : new Blob([input], { type: "application/json" }));
    form.append(values["file-part"], new Blob([PNG_1X1], { type: "image/png" }), "readback-evidence.png");
    info(`parts: input (${values["input-as-string"] ? "text field" : "application/json blob"}), ${values["file-part"]} (image/png, ${PNG_1X1.length} bytes)`);

    const r = await paypalRaw({ method: "POST", path: `/v1/customer/disputes/${id}/provide-evidence`, requestId: `rb-spike07-provide-evidence-${id}`, form });
    show("provide-evidence", r);
    const after = await getDispute("after-provide-evidence");
    check(`evidence count went up (${before.evidences?.length ?? 0} -> ${after.evidences?.length ?? 0})`, (after.evidences?.length ?? 0) > (before.evidences?.length ?? 0));
    info(`status now ${after.status} (SPEC §8 expects UNDER_REVIEW before adjudicate)`);
    break;
  }

  case "adjudicate": {
    if (extra !== "SELLER_FAVOR" && extra !== "BUYER_FAVOR") usage(HELP);
    linkFor(await getDispute("before-adjudicate"), action);
    // Sandbox adjudicate takes only the outcome; PayPal picks adjudications[].reason itself.
    show("adjudicate", await post(action, { adjudication_outcome: extra }));
    const after = await getDispute("after-adjudicate");
    info(`adjudications[].reason: ${after.adjudications?.map((a) => a.reason).join(", ") || "(none yet; run 'get' again in a minute)"}`);
    break;
  }

  case "send-message": {
    if (!extra) usage(HELP);
    const before = await getDispute("before-send-message");
    linkFor(before, action);
    info(`stage ${before.dispute_life_cycle_stage} (PayPal only allows messages at INQUIRY)`);
    // The spec's description says a JSON body {message}; its requestBody says multipart with
    // only `message_document`. Try JSON first, then multipart with an `input` part.
    const asJson = await post(action, { message: extra });
    if (asJson.ok) {
      show("send-message-json", asJson);
    } else {
      saveFixture("07-send-message-json-response", asJson.json);
      console.log(`JSON body refused: HTTP ${asJson.status}\n${JSON.stringify(asJson.json, null, 2)}\nRetrying as multipart...`);
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify({ message: extra })], { type: "application/json" }));
      show("send-message-multipart", await paypalRaw({ method: "POST", path: `/v1/customer/disputes/${id}/send-message`, requestId: `rb-spike07-send-message-multipart-${id}`, form }));
    }
    const after = await getDispute("after-send-message");
    check("message count went up", (after.messages?.length ?? 0) > (before.messages?.length ?? 0));
    break;
  }

  default:
    usage(HELP);
}

