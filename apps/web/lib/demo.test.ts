import { evaluateCase, formatTerms, generateAgentKey, signActionProof, type Terms } from "@readbackhq/core";
import { describe, expect, it } from "vitest";
import { buildCaseBundle } from "./cases";
import { demoEnabled, directCharge } from "./demo";
import { paypalClient } from "./paypal/client";
import { fakePayPal } from "./paypal/fake";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
const NOW = new Date("2026-11-05T12:00:00Z");
const nowSec = NOW.getTime() / 1000;

async function setup(start = "2026-11-05") {
  const pp = fakePayPal();
  pp.clock.now = NOW.toISOString();
  const tab = await generateAgentKey(false); // the judge's non-extractable tab key
  const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start, end: "2027-03-31", fingerprint: tab.fingerprint };
  pp.tokens.set("judgeagr1", { id: "judgeagr1", payment_source: { paypal: { description: formatTerms(terms), payer_id: "JUDGE0000001" } } });
  return { pp, tab, client: paypalClient(ENV, pp.fetch) };
}

describe("demo direct charge (T32 guards)", () => {
  it("is off unless DEMO_MODE=true against the sandbox", () => {
    expect(demoEnabled({})).toBe(false);
    expect(demoEnabled({ DEMO_MODE: "true" })).toBe(true);
    expect(demoEnabled({ DEMO_MODE: "true", PAYPAL_API_BASE: "https://api-m.paypal.com" })).toBe(false);
    expect(demoEnabled({ DEMO_MODE: "1" })).toBe(false);
  });

  it("charges the judge's own agreement once; the case view then shows BUYER_FAVOR", async () => {
    const { pp, tab, client } = await setup();
    const proof = await signActionProof("judgeagr1", "direct-charge", nowSec, tab.privateKey, tab.publicJwk);
    const r = await directCharge(client, { tokenId: "judgeagr1", proof }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const post = pp.posts.find((p) => p.path === "/v2/checkout/orders")!;
    expect(post.requestId).toBe("rb-direct-judgeagr1");
    expect(JSON.stringify(post.body)).not.toMatch(/custom_id|stored_credential/);

    const lookup = await buildCaseBundle(r.captureId, client, new Date("2026-11-05T12:05:00Z"));
    if (!lookup.ok) throw new Error(lookup.message);
    expect((await evaluateCase(lookup.bundle)).classification).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });

    // A second one is refused by PayPal's duplicate-invoice block (fresh proof, same invoice).
    const again = await signActionProof("judgeagr1", "direct-charge", nowSec + 1, tab.privateKey, tab.publicJwk);
    pp.posts.length = 0;
    const second = await directCharge(paypalClient(ENV, pp.fetch), { tokenId: "judgeagr1", proof: again }, NOW);
    // Same PayPal-Request-Id → PayPal replays the original order rather than charging again.
    expect(second.ok && second.captureId).toBe(r.captureId);
  });

  it("refuses someone else's key, the wrong purpose, a stale proof, and old agreements", async () => {
    const { tab, client } = await setup();
    const other = await generateAgentKey(false);
    const code = async (proof: string, now = NOW) => {
      const r = await directCharge(client, { tokenId: "judgeagr1", proof }, now);
      return r.ok ? "OK" : r.failure.code;
    };
    expect(await code(await signActionProof("judgeagr1", "direct-charge", nowSec, other.privateKey, other.publicJwk))).toBe("KEY_NOT_APPROVED");
    expect(await code(await signActionProof("judgeagr1", "revoke", nowSec, tab.privateKey, tab.publicJwk))).toBe("ACTION_WRONG_PURPOSE");
    expect(await code(await signActionProof("judgeagr1", "direct-charge", nowSec - 120, tab.privateKey, tab.publicJwk))).toBe("ACTION_STALE");

    const { tab: tab2, client: client2 } = await setup("2026-10-21"); // e.g. the hero agreement
    const proof = await signActionProof("judgeagr1", "direct-charge", nowSec, tab2.privateKey, tab2.publicJwk);
    const r = await directCharge(client2, { tokenId: "judgeagr1", proof }, NOW);
    expect(r.ok ? "OK" : r.failure.code).toBe("NOT_A_JUDGE_AGREEMENT");

    // A judge who approved just before UTC midnight can still play the dishonest merchant; older can't.
    for (const [start, want] of [["2026-11-04", "OK"], ["2026-11-03", "NOT_A_JUDGE_AGREEMENT"]] as const) {
      const s = await setup(start);
      const p = await signActionProof("judgeagr1", "direct-charge", nowSec, s.tab.privateKey, s.tab.publicJwk);
      const res = await directCharge(s.client, { tokenId: "judgeagr1", proof: p }, NOW);
      expect(res.ok ? "OK" : res.failure.code).toBe(want);
    }
  });
});
