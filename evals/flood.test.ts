// Dispute flood (Oct 26): many disputes at once, measured against Readback's own stack over the
// PayPal fake, never against PayPal's sandbox. Real charges go through the real gate; disputes are
// opened on them; then the queue, case building, evidence sending and webhooks are measured: PayPal
// calls per request (amplification), whether every dispute is accounted for, and correctness.
import { buildMandate, evaluateCase, formatTerms, generateAgentKey, sha256Hex, signMandate, type Terms } from "@readbackhq/core";
import { describe, expect, it } from "vitest";
import { runDisputeAction } from "../apps/web/lib/actions.ts";
import { buildCaseBundle } from "../apps/web/lib/cases.ts";
import { checkout } from "../apps/web/lib/checkout.ts";
import { paypalClient } from "../apps/web/lib/paypal/client.ts";
import { fakePayPal } from "../apps/web/lib/paypal/fake.ts";
import { buildQueue } from "../apps/web/lib/queue.ts";
import { verifyWebhook } from "../apps/web/lib/webhooks.ts";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
const DAY = 86_400_000;
const START = Date.parse("2026-08-01T00:00:00Z");

// `agreements` agreements, each with `days` daily signed charges through the real gate; then
// `disputed` of each agreement's charges get an UNAUTHORISED dispute (newest charges first).
async function flood(o: { agreements: number; days: number; disputed: number }) {
  const pp = fakePayPal();
  const key = await generateAgentKey(true);
  const client = paypalClient(ENV, pp.fetch);
  const captures: { token: string; capture: string }[] = [];
  for (let a = 0; a < o.agreements; a++) {
    const token = `flood${String(a).padStart(4, "0")}`;
    const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-08-01", end: "2027-03-31", fingerprint: key.fingerprint };
    const text = formatTerms(terms);
    pp.tokens.set(token, { id: token, payment_source: { paypal: { description: text, payer_id: `PAYER${a}` } } });
    const th = await sha256Hex(text);
    for (let d = 0; d < o.days; d++) {
      const iat = (START + d * DAY + 15 * 3_600_000) / 1000;
      pp.clock.now = new Date((iat + 5) * 1000).toISOString();
      const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: token, terms, termsHash: th }, iat, `jti-${a}-${d}-x`);
      if (!m.ok) throw new Error(m.error.code);
      const r = await checkout(await signMandate(m.value, key.privateKey, key.publicJwk), client, iat + 5);
      if (!r.ok) throw new Error(r.failures.map((f) => f.code).join());
      captures.push({ token, capture: r.captureId });
    }
  }
  const disputes: string[] = [];
  for (let a = 0; a < o.agreements; a++) {
    const mine = captures.filter((c) => c.token === `flood${String(a).padStart(4, "0")}`).slice(-o.disputed);
    for (const c of mine) disputes.push(pp.openDispute(c.capture, "UNAUTHORISED"));
  }
  const now = new Date(START + (o.days + 1) * DAY);
  pp.calls.length = 0; // count only what happens after setup
  return { pp, client, disputes, now };
}

const byPath = (calls: { path: string }[]) =>
  calls.reduce<Record<string, number>>((acc, c) => {
    const k = c.path.replace(/\/[A-Z0-9-]{8,}$/, "/:id").replace(/\/v1\/customer\/disputes\/[^/]+\//, "/v1/customer/disputes/:id/");
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

describe("dispute flood (regression numbers from Oct 26: before → after)", () => {
  it("one case when every earlier charge is disputed: 65 PayPal calls → at most 20 (bounded history walk)", async () => {
    const f = await flood({ agreements: 1, days: 60, disputed: 60 });
    const lookup = await buildCaseBundle(f.disputes.at(-1)!, f.client, f.now);
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    console.log(`one case, all disputed: ${f.pp.calls.length} PayPal calls`, byPath(f.pp.calls));
    expect(f.pp.calls.length).toBeLessThanOrEqual(20);
    // It says why instead of claiming there's no history.
    const r = await evaluateCase(lookup.bundle);
    expect(r.checks.find((c) => c.id === "11")!.failures[0]!.code).toBe("HISTORY_NOT_ESTABLISHED");
    expect(r.classification.suggestion).not.toBe("SELLER_FAVOR");
  }, 120_000);

  it("rate limited mid-build: every listed dispute still appears (14/60 → all), unloaded ones without a verdict", async () => {
    const f = await flood({ agreements: 60, days: 3, disputed: 1 });
    const clean = await buildQueue(f.client, f.now);
    f.pp.calls.length = 0;
    f.pp.knobs.rateLimitAfter = 150;
    const q = await buildQueue(f.client, f.now);
    const live = q.rows.filter((r) => r.source === "Live");
    console.log(`queue under rate limiting: ${live.length} listed, ${live.filter((r) => !r.loaded).length} not loaded; notices: ${q.notices.join(" | ")}`);
    expect(live).toHaveLength(50);
    expect(q.notices.join(" ")).toMatch(/PayPal has more/);
    expect(q.notices.join(" ")).toMatch(/couldn't be evaluated/);
    for (const r of live.filter((x) => !x.loaded)) expect(r).toMatchObject({ suggestion: null, lights: [], note: expect.stringMatching(/rate-limiting/) });
    // No loaded row shows a different verdict than it does without rate limiting.
    const before = new Map(clean.rows.map((r) => [r.id, r.suggestion]));
    for (const r of live.filter((x) => x.loaded)) expect(r.suggestion).toBe(before.get(r.id));
  }, 300_000);

  it("slow PayPal: the queue stops at its time budget and lists the rest as not loaded", async () => {
    const f = await flood({ agreements: 12, days: 3, disputed: 1 });
    f.pp.knobs.latencyMs = 100;
    const t0 = Date.now();
    const q = await buildQueue(f.client, f.now, 1_500);
    const ms = Date.now() - t0;
    const live = q.rows.filter((r) => r.source === "Live");
    console.log(`queue (12 disputes, 100 ms/call, 1.5 s budget): ${ms} ms, ${live.filter((r) => r.loaded).length} loaded`);
    expect(live).toHaveLength(12);
    expect(live.some((r) => !r.loaded && /time limit/.test(r.note))).toBe(true);
    expect(ms).toBeLessThan(6_000); // the budget plus the cases already in flight
  }, 300_000);

  it("ten concurrent evidence sends on one dispute leave exactly one statement", async () => {
    const f = await flood({ agreements: 1, days: 10, disputed: 1 });
    const id = f.disputes[0]!;
    await Promise.all(Array.from({ length: 10 }, () => runDisputeAction(f.client, id, { action: "send_evidence" }, f.now)));
    const requestIds = new Set(f.pp.posts.filter((p) => p.path.endsWith("/provide-supporting-info")).map((p) => p.requestId));
    expect(requestIds.size).toBe(1); // every send used the same deterministic PayPal-Request-Id
    expect((f.pp.disputes.get(id)!["supporting_info"] as unknown[]).length).toBe(1);
  }, 120_000);

  it("1,000 forged webhooks cost no PayPal calls (1,000 → 0); a genuine-looking one still gets verified", async () => {
    const pp = fakePayPal();
    const client = paypalClient(ENV, pp.fetch);
    const forged = new Headers({ "paypal-auth-algo": "x", "paypal-cert-url": "https://evil.example/cert", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "now" });
    for (let i = 0; i < 1000; i++) await verifyWebhook(client, forged, JSON.stringify({ id: `WH-${i}`, event_type: "CUSTOMER.DISPUTE.CREATED" }), "WEBHOOK1");
    expect(pp.calls.filter((c) => c.path.includes("verify-webhook-signature"))).toHaveLength(0);
    const plausible = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "now" });
    await verifyWebhook(client, plausible, JSON.stringify({ id: "WH-real", event_type: "CUSTOMER.DISPUTE.CREATED" }), "WEBHOOK1");
    expect(pp.calls.filter((c) => c.path.includes("verify-webhook-signature"))).toHaveLength(1);
  }, 120_000);
});
