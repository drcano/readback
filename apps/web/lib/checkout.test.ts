import { type AgentKey, formatTerms, generateAgentKey, sha256Hex, buildMandate, signMandate, type Terms } from "@readbackhq/core";
import { beforeEach, describe, expect, it } from "vitest";
import { checkout } from "./checkout";
import { paypalClient } from "./paypal/client";
import { fakePayPal, type FakePayPal } from "./paypal/fake";

const TOKEN = "8kd73hs9ab";
const NOW = Date.parse("2026-11-08T15:00:00Z") / 1000;
const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com" };
let agent: AgentKey;
let terms: Terms;
let pp: FakePayPal;

beforeEach(async () => {
  agent ??= await generateAgentKey(true);
  terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint };
  pp = fakePayPal();
  pp.tokens.set(TOKEN, { id: TOKEN, payment_source: { paypal: { description: formatTerms(terms), payer_id: "FAKEPAYER0001" } } });
});

async function mandate(opts: { sku?: string; unitCents?: number; at?: number; jti?: string } = {}) {
  const loose = { ...terms, sku: opts.sku ?? terms.sku, capCents: 999_999 }; // lets tests sign out-of-terms requests
  const m = buildMandate({ sku: opts.sku ?? "GBP-SR24", qty: 1, unitCents: opts.unitCents ?? 6499 }, { tokenId: TOKEN, terms: loose, termsHash: await sha256Hex(formatTerms(terms)) }, opts.at ?? NOW - 5, opts.jti ?? "jti-checkout-1");
  if (!m.ok) throw new Error(m.error.code);
  return signMandate(m.value, agent.privateKey, agent.publicJwk);
}

const run = async (jws: string, now = NOW) => checkout(jws, paypalClient(ENV, pp.fetch), now);
const codes = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? "OK" : r.failures.map((f) => f.code));

describe("checkout gate", () => {
  it("charges an in-terms signed request with the canonical labels and a deterministic request ID", async () => {
    const r = await run(await mandate());
    expect(r).toMatchObject({ ok: true, invoiceId: `RB-${TOKEN}-P019` });
    const post = pp.posts.find((p) => p.path === "/v2/checkout/orders")!;
    expect(post.requestId).toMatch(/^rb-[0-9a-f]{40}$/);
    expect(post.body).toMatchObject({ payment_source: { paypal: { vault_id: TOKEN } }, purchase_units: [{ invoice_id: `RB-${TOKEN}-P019` }] });
  });

  it("a resubmitted identical mandate is a no-op at PayPal (same request ID, same order)", async () => {
    const jws = await mandate();
    const [a, b] = [await run(jws), await run(jws)];
    expect(a.ok && b.ok && a.orderId === b.orderId).toBe(true);
    expect(pp.orders.size).toBe(1);
  });

  it("a dropped order create is retried once with the same request ID, and PayPal makes one order", async () => {
    let dropped = false;
    const flaky: typeof fetch = async (input, init) => {
      const res = await pp.fetch(input, init); // PayPal acts, then the answer is lost (seed runs, Oct 23 and 25)
      if (!dropped && String(input).endsWith("/v2/checkout/orders") && init?.method === "POST") {
        dropped = true;
        throw new TypeError("fetch failed");
      }
      return res;
    };
    const r = await checkout(await mandate(), paypalClient(ENV, flaky), NOW);
    expect(r.ok).toBe(true);
    expect(pp.orders.size).toBe(1);
    const creates = pp.posts.filter((p) => p.path === "/v2/checkout/orders");
    expect(creates).toHaveLength(2);
    expect(creates[0]!.requestId).toBe(creates[1]!.requestId);
  });

  it("PayPal still unreachable after the retry is a plain-language denial, not a crash", async () => {
    const down: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/v2/checkout/orders")) throw new TypeError("fetch failed");
      return pp.fetch(input, init);
    };
    expect(codes(await checkout(await mandate(), paypalClient(ENV, down), NOW))).toEqual(["PAYPAL_UNAVAILABLE"]);
  });

  // Edge-case review, Oct 27: a 5xx used to read "PayPal refused the charge (HTTP_502)", and a held
  // charge "PayPal didn't complete the charge", though PayPal may have created it.
  it("PayPal answering 5xx after the retry reads as unavailable (asking again is safe), not refused", async () => {
    const busy: typeof fetch = async (input, init) =>
      String(input).endsWith("/v2/checkout/orders") ? new Response("<html>busy</html>", { status: 502 }) : pp.fetch(input, init);
    expect(codes(await checkout(await mandate(), paypalClient(ENV, busy), NOW))).toEqual(["PAYPAL_UNAVAILABLE"]);
  });

  it("a charge PayPal holds for review says so, and a declined one says nothing was charged", async () => {
    for (const [status, code, text] of [["PENDING", "CAPTURE_PENDING", /holding this charge/], ["DECLINED", "CAPTURE_NOT_COMPLETED", /nothing was charged/]] as const) {
      pp = fakePayPal();
      pp.tokens.set(TOKEN, { id: TOKEN, payment_source: { paypal: { description: formatTerms(terms), payer_id: "FAKEPAYER0001" } } });
      const held: typeof fetch = async (input, init) => {
        const res = await pp.fetch(input, init);
        if (!String(input).endsWith("/v2/checkout/orders") || init?.method !== "POST") return res;
        const order = (await res.json()) as { purchase_units: { payments: { captures: { status: string }[] } }[] };
        order.purchase_units[0]!.payments.captures[0]!.status = status;
        return Response.json(order, { status: res.status });
      };
      const r = await checkout(await mandate(), paypalClient(ENV, held), NOW);
      expect(r.ok ? "OK" : [r.failures[0]!.code, text.test(r.failures[0]!.message)]).toEqual([code, true]);
    }
  });

  it("a second request in the same period is refused by PayPal's duplicate-invoice block", async () => {
    await run(await mandate({ jti: "jti-first-001" }));
    expect(codes(await run(await mandate({ jti: "jti-second-01" })))).toEqual(["ALREADY_ORDERED_THIS_PERIOD"]);
  });

  it("refuses without calling PayPal for bad signatures, stale requests, and out-of-terms requests", async () => {
    expect(codes(await run("garbage"))).toEqual(["JWS_MALFORMED"]);
    expect(codes(await run(await mandate(), NOW + 600))).toEqual(["EXPIRED"]);
    expect(codes(await run(await mandate({ unitCents: 7000 })))).toEqual(["PRICE_CHANGED"]);
    expect(codes(await run(await mandate({ unitCents: 699 })))).toEqual(["PRICE_CHANGED"]); // price-swap attack
    expect(codes(await run(await mandate({ sku: "GBP-PREMIUM", unitCents: 14999 })))).toEqual(["SKU_NOT_APPROVED", "OVER_CAP"]); // every reason, not just the first
    expect(codes(await run(await mandate({ sku: "NOT-SOLD" })))).toEqual(["UNKNOWN_ITEM"]);
    expect(pp.posts).toEqual([]);
  });

  it("a cancelled agreement is refused", async () => {
    pp.tokens.delete(TOKEN);
    expect(codes(await run(await mandate()))).toEqual(["AGREEMENT_NOT_ACTIVE"]);
    expect(pp.posts).toEqual([]);
  });
});

describe("PayPal response shapes", () => {
  it("an unexpected shape from PayPal is a denial, not a crash", async () => {
    const weird = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "t" });
      return Response.json({ surprise: true }); // token GET returns something unrecognizable
    }) as typeof fetch;
    const r = await checkout(await mandate(), paypalClient(ENV, weird), NOW);
    expect(r.ok).toBe(false);
  });
});
