// Audit findings 7 and 8: the case is built from the purchase unit that owns the disputed capture,
// and the public bundle carries hashed addresses, not street addresses.
import { evaluateCase, formatTerms, type Terms } from "@readback/core";
import { describe, expect, it } from "vitest";
import { buildCaseBundle } from "./cases.ts";
import { paypalClient } from "./paypal-client.ts";

const ADDRESS = { address_line_1: "1 Example St", admin_area_2: "Springfield", admin_area_1: "CA", postal_code: "00000", country_code: "US" };
const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: "a".repeat(16) };

// A PayPal stand-in answering from a fixed table of path → JSON.
function paypalAnswering(table: Record<string, unknown>) {
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "t" });
    if (url.pathname === "/v1/reporting/transactions") return Response.json({ transaction_details: [], total_pages: 1 });
    const body = table[url.pathname];
    return body ? Response.json(body) : Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
  }) as typeof fetch;
  return paypalClient({ PAYPAL_CLIENT_ID: "i", PAYPAL_CLIENT_SECRET: "s" }, f);
}

const pu = (captureId: string, sku: string, address = ADDRESS) => ({
  description: formatTerms(terms),
  amount: { currency_code: "USD", value: "64.99" },
  items: [{ name: "x", sku, quantity: "1", unit_amount: { currency_code: "USD", value: "64.99" } }],
  shipping: { address, trackers: [{ id: "TRK", status: "SHIPPED" }] },
  payments: { captures: [{ id: captureId, status: "COMPLETED" }] },
});

function table(orderAddress = ADDRESS) {
  return {
    "/v2/payments/captures/CAP-2": { id: "CAP-2", status: "COMPLETED", amount: { currency_code: "USD", value: "64.99" }, create_time: "2026-11-08T15:00:00Z", supplementary_data: { related_ids: { order_id: "ORDER-1" } } },
    "/v2/checkout/orders/ORDER-1": {
      id: "ORDER-1",
      payer: { payer_id: "MAYA00000001" },
      payment_source: { paypal: { attributes: { vault: { id: "tok1" } } } },
      purchase_units: [pu("CAP-1", "FIRST-PU"), pu("CAP-2", "SECOND-PU", orderAddress)],
    },
    "/v3/vault/payment-tokens/tok1": { id: "tok1", payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA00000001", shipping: { address: ADDRESS } } } },
  };
}

describe("case bundle", () => {
  it("evaluates the purchase unit that owns the disputed capture (finding 7)", async () => {
    const r = await buildCaseBundle("CAP-2", paypalAnswering(table()), new Date("2026-11-09T00:00:00Z"));
    expect(r.ok && r.bundle.order.purchase_units.map((p) => p.items?.[0]?.sku)).toEqual(["SECOND-PU"]);
  });

  it("fails closed when the order doesn't contain the capture", async () => {
    const t = table();
    t["/v2/checkout/orders/ORDER-1"].purchase_units = [pu("CAP-9", "OTHER")];
    expect(await buildCaseBundle("CAP-2", paypalAnswering(t), new Date())).toMatchObject({ ok: false, status: 422 });
  });

  it("hashes addresses but still lets check 10 compare them (finding 8)", async () => {
    const same = await buildCaseBundle("CAP-2", paypalAnswering(table()), new Date("2026-11-09T00:00:00Z"));
    if (!same.ok) throw new Error(same.message);
    expect(JSON.stringify(same.bundle)).not.toMatch(/Example St|Springfield|"00000"/); // the postcode as a value, not inside the payer ID
    expect((await evaluateCase(same.bundle)).checks.find((c) => c.id === "10")!.failures.map((f) => f.code)).toEqual([]);

    const moved = await buildCaseBundle("CAP-2", paypalAnswering(table({ ...ADDRESS, postal_code: "99999" })), new Date("2026-11-09T00:00:00Z"));
    if (!moved.ok) throw new Error(moved.message);
    expect((await evaluateCase(moved.bundle)).checks.find((c) => c.id === "10")!.failures.map((f) => f.code)).toEqual(["ADDRESS_DIFFERS"]);
  });
});
