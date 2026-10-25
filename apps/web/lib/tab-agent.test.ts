// The judge's tab as the agent: the runtime's pre-checks, then the real checkout gate over the PayPal fake.
import { type AgentKey, formatTerms, generateAgentKey, type Terms } from "@readback/core";
import { beforeAll, describe, expect, it } from "vitest";
import { checkout } from "./checkout";
import { paypalClient } from "./paypal/client";
import { fakePayPal } from "./paypal/fake";
import { signAndBuy } from "./tab-agent";

const TOKEN = "judgetoken01";
let key: AgentKey;
let stranger: AgentKey;
beforeAll(async () => {
  [key, stranger] = await Promise.all([generateAgentKey(false), generateAgentKey(false)]);
});

function shop(fingerprint: string) {
  const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: new Date().toISOString().slice(0, 10), end: "2027-12-31", fingerprint };
  const pp = fakePayPal();
  pp.tokens.set(TOKEN, { id: TOKEN, payment_source: { paypal: { description: formatTerms(terms), payer_id: "JUDGE0000001" } } });
  const checkouts: string[] = [];
  // Stands in for the web app's two routes the tab calls.
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/agreements/")) return Response.json({ ok: true, terms: formatTerms(terms) });
    const { mandate } = JSON.parse(String(init?.body)) as { mandate: string };
    checkouts.push(mandate);
    return Response.json(await checkout(mandate, paypalClient({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }, pp.fetch), Math.floor(Date.now() / 1000)));
  }) as typeof fetch;
  return { fetchImpl, checkouts, pp };
}

describe("tab agent", () => {
  it("signs an in-terms order and the gate charges it", async () => {
    const s = shop(key.fingerprint);
    const r = await signAndBuy(key, TOKEN, "GBP-SR24", 1, s.fetchImpl);
    expect(r.outcome).toBe("charged");
    expect(s.pp.orders.size).toBe(1);
  });

  it("refuses to sign what Claude asks outside her terms: nothing reaches the gate", async () => {
    const s = shop(key.fingerprint);
    for (const [sku, qty] of [["GBP-PREMIUM", 3], ["GBP-SR24", 3], ["NOT-A-SKU", 1]] as const) {
      expect((await signAndBuy(key, TOKEN, sku, qty, s.fetchImpl)).outcome).toBe("refused");
    }
    expect(s.checkouts).toHaveLength(0);
  });

  it("refuses to act under terms that name another key (T21)", async () => {
    const s = shop(stranger.fingerprint);
    expect((await signAndBuy(key, TOKEN, "GBP-SR24", 1, s.fetchImpl)).outcome).toBe("refused");
    expect(s.checkouts).toHaveLength(0);
  });

  it("a second order in the period is signed, then refused by PayPal", async () => {
    const s = shop(key.fingerprint);
    await signAndBuy(key, TOKEN, "GBP-SR24", 1, s.fetchImpl);
    const r = await signAndBuy(key, TOKEN, "GBP-SR24", 1, s.fetchImpl);
    expect(r.outcome).toBe("denied");
    expect(r.message).toMatch(/Already ordered this period/);
  });
});
