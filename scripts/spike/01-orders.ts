// Spike #1 (must pass): create + capture an order with custom_id, confirm custom_id round-trips on GET.
// Run: pnpm spike:orders
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { paypal } from "./paypal.ts";

// Shape of the fields we read back. Spike only; product code parses with zod.
type Order = {
  id: string;
  status: string;
  links: { rel: string; href: string }[];
  purchase_units: {
    custom_id?: string;
    payments?: { captures?: { id: string; status: string; custom_id?: string }[] };
  }[];
};

// Stand-in for a GATE_ALLOW clip hash: 64 hex chars, same length as the real thing.
const customId = createHash("sha256").update(`spike-${Date.now()}`).digest("hex");

const created = (await paypal("POST", "/v2/checkout/orders", {
  intent: "CAPTURE",
  purchase_units: [{ custom_id: customId, amount: { currency_code: "USD", value: "1.00" } }],
})) as Order;
console.log("order", created.id, created.status);

const fetched = (await paypal("GET", `/v2/checkout/orders/${created.id}`)) as Order;
check("custom_id on GET after create", fetched.purchase_units[0]?.custom_id === customId);

const approve = created.links.find((l) => l.rel === "approve")?.href;
console.log(`\nLog in as your SANDBOX PERSONAL account and approve:\n  ${approve}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter once approved...");
rl.close();

const captured = (await paypal("POST", `/v2/checkout/orders/${created.id}/capture`, {})) as Order;
const capture = captured.purchase_units[0]?.payments?.captures?.[0];
console.log("capture", capture?.id, capture?.status);

const after = (await paypal("GET", `/v2/checkout/orders/${created.id}`)) as Order;
check("custom_id on GET after capture", after.purchase_units[0]?.custom_id === customId);
check("custom_id on the capture itself", after.purchase_units[0]?.payments?.captures?.[0]?.custom_id === customId);

function check(label: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}
