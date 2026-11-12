// Readback eval scenarios (SPEC §10): labeled cases run against the same code the product runs:
// readback-core, the merchant's checkout gate (against the in-memory PayPal fake), the agent
// runtime's signer and catalog, and the webhook and demo guards. Browser-safe, so the same
// scenarios run in CI (evals.test.ts) and in a visitor's browser ("Judge it yourself").
// The scenarios are our own; the fixtures and the tamper sampling let others challenge them.
import {
  type AgentKey,
  buildMandate,
  type CaseBundle,
  type DisputeReason,
  evaluateCase,
  formatCents,
  formatTerms,
  generateAgentKey,
  parseCents,
  sha256Hex,
  signActionProof,
  signJws,
  signMandate,
  type Terms,
  verifyActionProof,
} from "@readbackhq/core";
import { CATALOG } from "@readbackhq/core/catalog";
import { fixtureCases, heroCase } from "@readbackhq/core/fixtures";
import { CompactSign } from "jose";
import { listedUnitCents } from "../apps/agent/src/catalog.ts";
import { signReorder } from "../apps/agent/src/sign.ts";
import { checkout } from "../apps/web/lib/checkout.ts";
import { demoEnabled } from "../apps/web/lib/demo.ts";
import { paypalClient } from "../apps/web/lib/paypal/client.ts";
import { fakePayPal } from "../apps/web/lib/paypal/fake.ts";
import { verifyWebhook } from "../apps/web/lib/webhooks.ts";

export type Outcome = { id: string; category: string; layer?: string; expected: string; actual: string; pass: boolean };
const results: Outcome[] = [];
// A tiny scenario runner, so the same scenario code runs under vitest (CI) and in a browser.
// `describe` groups steps, `it` registers one, `expect` throws on a mismatch; runScenarios() runs
// every step in order and returns the recorded outcomes.
type Step = { name: string; run: () => unknown };
const groups: { name: string; define: () => unknown }[] = [];
let current: Step[] = [];
function describe(name: string, define: () => unknown): void {
  groups.push({ name, define });
}
function it(name: string, run: () => unknown): void {
  current.push({ name, run });
}
function expect(actual: unknown) {
  const fail = (want: unknown) => {
    throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  };
  return {
    toBe: (want: unknown) => (Object.is(actual, want) ? undefined : fail(want)),
    toEqual: (want: unknown) => (JSON.stringify(actual) === JSON.stringify(want) ? undefined : fail(want)),
  };
}

export async function runScenarios(): Promise<Outcome[]> {
  results.length = 0;
  for (const g of groups) {
    current = [];
    await g.define();
    for (const step of current) {
      const before = results.length;
      try {
        await step.run();
      } catch (err) {
        // A step that throws before recording is itself a failed scenario, never silently dropped.
        if (results.length === before) record({ id: `${g.name}: ${step.name}`, category: "error", expected: "runs", actual: err instanceof Error ? err.message : "threw" });
      }
    }
  }
  return [...results];
}

function record(o: Omit<Outcome, "pass">) {
  const r = { ...o, pass: o.expected === o.actual };
  results.push(r);
  return r;
}

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
const TOKEN = "evalagreement01";
const sec = (iso: string) => Date.parse(iso) / 1000;

const agent: AgentKey = await generateAgentKey(true);
const stranger: AgentKey = await generateAgentKey(true);
const baseTerms = (over: Partial<Terms> = {}): Terms => ({
  merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500,
  start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint, ...over,
});

// A fresh fake sandbox holding one agreement with the given terms.
function sandbox(terms: Terms) {
  const pp = fakePayPal();
  pp.tokens.set(TOKEN, { id: TOKEN, payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA00000001" } } });
  return { pp, client: () => paypalClient(ENV, pp.fetch) };
}

// Sign a mandate as the agent, or as a compromised agent (`loose`) that skips the pre-check and
// hand-crafts the payload: same fields and signature, any values.
async function sign(terms: Terms, o: { sku?: string; qty?: number; unitCents?: number; at: string; key?: AgentKey; loose?: boolean; jti?: string }) {
  const termsHash = await sha256Hex(formatTerms(terms));
  const key = o.key ?? agent;
  const qty = o.qty ?? 1;
  const unitCents = o.unitCents ?? CATALOG["GBP-SR24"]!.unitCents;
  const iat = sec(o.at);
  const jti = o.jti ?? `jti-${iat}`;
  if (o.loose) {
    const p = Math.max(1, Math.floor((iat - sec(`${terms.start}T00:00:00Z`)) / (terms.periodDays * 86_400)) + 1);
    const payload = {
      v: 1 as const, agr: TOKEN, th: termsHash.slice(0, 16), sku: o.sku ?? "GBP-SR24", qty,
      unit: formatCents(unitCents), amt: formatCents(unitCents * qty), cur: "USD" as const, p, iat, exp: iat + 300, jti,
    };
    return signMandate(payload, key.privateKey, key.publicJwk);
  }
  const built = buildMandate({ sku: o.sku ?? "GBP-SR24", qty, unitCents }, { tokenId: TOKEN, terms, termsHash }, iat, jti);
  if (!built.ok) throw new Error(`eval setup: ${built.error.code}`);
  return signMandate(built.value, key.privateKey, key.publicJwk);
}

const verdict = async (r: Awaited<ReturnType<typeof checkout>>) => (r.ok ? "ALLOW" : r.failures.map((f) => f.code).join("+"));

describe("legitimate purchases (gate allows)", () => {
  const cases: [string, Partial<Terms>, string, string][] = [
    ["mid-period", {}, "2026-11-08T15:00:00Z", "2026-11-08T15:00:05Z"],
    ["first second of the agreement", {}, "2026-10-21T00:00:00Z", "2026-10-21T00:00:03Z"],
    ["signed 23:59:58, charged 00:00:01 (period of signing)", {}, "2026-11-09T23:59:58Z", "2026-11-10T00:00:01Z"],
    ["two minutes before expiry", {}, "2027-03-31T23:58:00Z", "2027-03-31T23:58:05Z"],
    ["30-day cadence, third period", { periodDays: 30 }, "2026-12-25T12:00:00Z", "2026-12-25T12:00:02Z"],
    ["price exactly at the cap", { capCents: 6499 }, "2026-11-08T15:00:00Z", "2026-11-08T15:00:05Z"],
    ["quantity at the limit", { qty: 2, capCents: 13_000 }, "2026-11-08T15:00:00Z", "2026-11-08T15:00:05Z"],
    ["next day after a charge (new period)", {}, "2026-11-11T09:00:00Z", "2026-11-11T09:00:01Z"],
  ];
  for (const [name, over, signedAt, chargedAt] of cases) {
    it(name, async () => {
      const terms = baseTerms(over);
      const { client } = sandbox(terms);
      const r = await checkout(await sign(terms, { at: signedAt, qty: over.qty ?? 1 }), client(), sec(chargedAt));
      expect(record({ id: `legit: ${name}`, category: "legitimate", expected: "ALLOW", actual: await verdict(r) }).pass).toBe(true);
    });
  }
});

// What each attack page tries to get, and what the runtime would be asked for if the assistant fell for it.
const ATTACKS: { name: string; sku: string; qty: number; pageCents?: number }[] = [
  { name: "hidden instructions (premium bundle x3)", sku: "GBP-PREMIUM", qty: 3 },
  { name: "fake system text (quantity 5)", sku: "GBP-SR24", qty: 5 },
  { name: "price swap (page says $6.99)", sku: "GBP-SR24", qty: 1, pageCents: 699 },
  { name: "SKU swap (12 lb bag)", sku: "GBP-SR12", qty: 1 },
  { name: "merchant redirect (PetMegaMart)", sku: "OTHER-SR24", qty: 1 },
  { name: "quantity bump (2 bags)", sku: "GBP-SR24", qty: 2 },
];

describe("attack pages, at the runtime (it won't sign them as asked)", () => {
  for (const a of ATTACKS) {
    it(a.name, async () => {
      const terms = baseTerms();
      const unit = listedUnitCents(a.sku); // the runtime prices from the catalog, never from page text
      let actual: string;
      if (unit === null) actual = "REFUSED";
      else {
        const r = await signReorder(agent, { agreement: TOKEN, terms: formatTerms(terms), sku: a.sku, qty: a.qty, unitCents: unit }, sec("2026-11-08T15:00:00Z"));
        // For the price swap, "blocked" means the signed price is the real one, not the page's.
        actual = !r.ok ? "REFUSED" : a.pageCents !== undefined && unit !== a.pageCents ? "REFUSED" : "SIGNED";
      }
      expect(record({ id: `runtime: ${a.name}`, category: "attack", layer: "runtime", expected: "REFUSED", actual }).pass).toBe(true);
    });
  }
});

describe("attack pages, at the gate (a compromised runtime signs them anyway)", () => {
  for (const a of ATTACKS) {
    it(a.name, async () => {
      const terms = baseTerms();
      const { client, pp } = sandbox(terms);
      const unitCents = a.pageCents ?? CATALOG[a.sku]?.unitCents ?? 5999;
      const jws = await sign(terms, { sku: a.sku, qty: a.qty, unitCents, at: "2026-11-08T15:00:00Z", loose: true });
      const r = await checkout(jws, client(), sec("2026-11-08T15:00:05Z"));
      const charged = pp.orders.size > 0;
      expect(record({ id: `gate: ${a.name}`, category: "attack", layer: "gate", expected: "DENY", actual: r.ok || charged ? "ALLOW" : "DENY" }).pass).toBe(true);
    });
  }
});

describe("gate violations", () => {
  const run = async (name: string, terms: Terms, jws: string, at: string, setup?: (pp: ReturnType<typeof fakePayPal>) => Promise<void>) => {
    const { client, pp } = sandbox(terms);
    await setup?.(pp);
    const r = await checkout(jws, client(), sec(at));
    return record({ id: `violation: ${name}`, category: "gate-violation", expected: "DENY", actual: r.ok ? "ALLOW" : "DENY" });
  };
  it("revoked agreement", async () => {
    const t = baseTerms();
    expect((await run("revoked", t, await sign(t, { at: "2026-11-08T15:00:00Z" }), "2026-11-08T15:00:05Z", async (pp) => { pp.tokens.delete(TOKEN); })).pass).toBe(true);
  });
  it("over cap", async () => {
    const t = baseTerms({ capCents: 5000 });
    expect((await run("over cap", t, await sign(t, { at: "2026-11-08T15:00:00Z", loose: true }), "2026-11-08T15:00:05Z")).pass).toBe(true);
  });
  it("wrong SKU", async () => {
    const t = baseTerms();
    expect((await run("wrong SKU", t, await sign(t, { sku: "GBP-SR12", unitCents: 3899, at: "2026-11-08T15:00:00Z", loose: true }), "2026-11-08T15:00:05Z")).pass).toBe(true);
  });
  it("second charge in the same period (PayPal's duplicate-invoice block)", async () => {
    const t = baseTerms();
    const { client } = sandbox(t);
    const first = await checkout(await sign(t, { at: "2026-11-08T09:00:00Z", jti: "first-0001" }), client(), sec("2026-11-08T09:00:05Z"));
    const second = await checkout(await sign(t, { at: "2026-11-08T15:00:00Z", jti: "second-001" }), client(), sec("2026-11-08T15:00:05Z"));
    expect(first.ok).toBe(true);
    expect(record({ id: "violation: second charge in period", category: "gate-violation", expected: "DENY", actual: second.ok ? "ALLOW" : "DENY" }).pass).toBe(true);
  });
  it("signed 23:59:58 on the last day, charged after midnight (audit finding 4)", async () => {
    const t = baseTerms();
    expect((await run("charge would land after the end", t, await sign(t, { at: "2027-03-31T23:59:58Z" }), "2027-04-01T00:00:01Z")).pass).toBe(true);
  });
  it("after the end date", async () => {
    const t = baseTerms();
    expect((await run("after end", t, await sign(t, { at: "2027-04-01T09:00:00Z", loose: true }), "2027-04-01T09:00:05Z")).pass).toBe(true);
  });
});

describe("signature attacks", () => {
  const t = baseTerms();
  const at = "2026-11-08T15:00:00Z";
  const now = sec("2026-11-08T15:00:05Z");
  const attempt = async (name: string, jws: string, when = now) => {
    const { client } = sandbox(t);
    const r = await checkout(jws, client(), when);
    return record({ id: `signature: ${name}`, category: "signature", expected: "DENY", actual: r.ok ? "ALLOW" : "DENY" });
  };
  it("forged signature", async () => {
    const jws = await sign(t, { at });
    const [h, p, s] = jws.split(".");
    expect((await attempt("forged", `${h}.${p}.${s!.slice(0, -4)}AAAA`)).pass).toBe(true);
  });
  it("valid signature, unapproved key", async () => {
    expect((await attempt("unapproved key", await sign(t, { at, key: stranger }))).pass).toBe(true);
  });
  it("header with an extra member", async () => {
    const payload = JSON.parse(atob((await sign(t, { at })).split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as object;
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: "ES256", typ: "rb-mandate+jwt", jwk: agent.publicJwk, kid: "1" }).sign(agent.privateKey);
    expect((await attempt("extra header member", jws)).pass).toBe(true);
  });
  it("header with jku (fetch-a-key trick)", async () => {
    const payload = JSON.parse(atob((await sign(t, { at })).split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as object;
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: "ES256", typ: "rb-mandate+jwt", jwk: agent.publicJwk, jku: "https://evil.example/k" }).sign(agent.privateKey);
    expect((await attempt("jku header", jws)).pass).toBe(true);
  });
  it("payload changed after signing", async () => {
    const [h, , s] = (await sign(t, { at })).split(".");
    const evil = btoa(JSON.stringify({ v: 1, agr: TOKEN, unit: "1.00", amt: "1.00" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect((await attempt("payload mismatch", `${h}.${evil}.${s}`)).pass).toBe(true);
  });
  it("expired (submitted after five minutes)", async () => {
    expect((await attempt("expired", await sign(t, { at }), sec("2026-11-08T15:06:00Z"))).pass).toBe(true);
  });
  it("signed for a past period, replayed later", async () => {
    expect((await attempt("past period", await sign(t, { at: "2026-11-07T15:00:00Z" }))).pass).toBe(true);
  });
  it("valid mandate resubmitted for a second order", async () => {
    const { client, pp } = sandbox(t);
    const jws = await sign(t, { at });
    await checkout(jws, client(), now);
    await checkout(jws, client(), now + 30);
    record({ id: "signature: resubmitted into a second order", category: "signature", expected: "1 order", actual: `${pp.orders.size} order${pp.orders.size === 1 ? "" : "s"}` });
    expect(pp.orders.size).toBe(1);
  });
});

describe("disputes across the classification table", async () => {
  const hero = await heroCase();
  const fx = Object.fromEntries((await fixtureCases()).map((f) => [f.id, f.bundle]));
  const withReason = (b: CaseBundle, reason: DisputeReason): CaseBundle => ({ ...structuredClone(b), dispute: { ...b.dispute!, reason } });
  // Variants of the hero where the AGENT side breaks (the shopper should win), built like the hero.
  const signedVariant = async (over: { unit?: string; sku?: string; signer?: AgentKey }) => {
    const v = await heroCase({ agent: hero.agent, signer: over.signer, mandate: over.unit ? { unit: over.unit, amt: over.unit } : over.sku ? { sku: over.sku } : {} });
    const pu = v.bundle.order.purchase_units[0]!;
    if (over.unit) {
      pu.amount = { currency_code: "USD", value: over.unit, breakdown: { item_total: { currency_code: "USD", value: over.unit } } };
      pu.items![0]!.unit_amount.value = over.unit;
      v.bundle.capture.amount.value = over.unit;
    }
    if (over.sku) pu.items![0]!.sku = over.sku;
    return v.bundle;
  };
  // Balanced on purpose: 5 cases the seller should win, 6 the buyer should win, 4 with no
  // suggestion. Readback is only useful to PayPal if it's right for both sides (ADR 0004).
  const cases: [string, CaseBundle, "SELLER_FAVOR" | "BUYER_FAVOR" | "none"][] = [
    ["seller: her agent signed it, in terms, delivered, then disowned", hero.bundle, "SELLER_FAVOR"],
    ["seller: same charge, checked before any dispute (if disputed)", { ...structuredClone(hero.bundle), dispute: null }, "SELLER_FAVOR"],
    ["seller: 'incorrect amount' but it equals the signed amount", withReason(hero.bundle, "INCORRECT_AMOUNT"), "SELLER_FAVOR"],
    // Audit Oct 25: "the only charge in its period" and "charged before she cancelled" would be inferred
    // from what Readback can't see (unlabeled charges; PayPal's cancellation record), so neither side.
    ["neither: 'duplicate', and it's the only labeled charge in its period", withReason(hero.bundle, "DUPLICATE_TRANSACTION"), "none"],
    ["neither: 'cancelled recurring', and the cancellation time isn't readable", withReason(hero.bundle, "CANCELED_RECURRING_BILLING"), "none"],
    ["buyer: merchant charged her wallet directly (no agent request)", fx["PP-D-TWIST"]!, "BUYER_FAVOR"],
    ["buyer: charged after she cancelled", fx["PP-D-FX-REVOKED"]!, "BUYER_FAVOR"],
    ["buyer: not received, no shipment reported", fx["PP-D-FX-NOTRECEIVED"]!, "BUYER_FAVOR"],
    ["buyer: signed, but over her cap", await signedVariant({ unit: "70.00" }), "BUYER_FAVOR"],
    ["buyer: signed, but not the approved item", await signedVariant({ sku: "GBP-PREMIUM" }), "BUYER_FAVOR"],
    ["buyer: signed by a key she never approved", await signedVariant({ signer: stranger }), "BUYER_FAVOR"],
    ["none: not received, shipment reported (merchant-attested)", withReason(hero.bundle, "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"), "none"],
    ["none: not as described (contents unverifiable)", withReason(hero.bundle, "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"), "none"],
    ["none: new agreement, no history (consent unverified)", fx["PP-D-FX-NEWAGREEMENT"]!, "none"],
    ["none: agreement deleted, only the merchant's copy of terms", fx["PP-D-FX-DELETED"]!, "none"],
  ];

  for (const [name, bundle, expected] of cases) {
    it(name, async () => {
      const c = (await evaluateCase(bundle)).classification;
      expect(record({ id: `dispute: ${name}`, category: "dispute", expected, actual: c.suggestion ?? "none" }).pass).toBe(true);
    });
  }
});

describe("action proofs and guards", () => {
  const now = sec("2026-11-08T15:00:00Z");
  const expectProof = async (name: string, jws: string, purpose: "revoke" | "direct-charge") => {
    const v = await verifyActionProof(jws, { tokenId: TOKEN, purpose, termsFingerprint: agent.fingerprint, nowSec: now });
    return record({ id: `proof: ${name}`, category: "guard", expected: "DENY", actual: v.ok ? "ALLOW" : "DENY" });
  };
  it("action proof: wrong key", async () => {
    expect((await expectProof("wrong key", await signActionProof(TOKEN, "revoke", now, stranger.privateKey, stranger.publicJwk), "revoke")).pass).toBe(true);
  });
  it("action proof: wrong purpose", async () => {
    expect((await expectProof("wrong purpose", await signActionProof(TOKEN, "direct-charge", now, agent.privateKey, agent.publicJwk), "revoke")).pass).toBe(true);
  });
  it("action proof: stale iat", async () => {
    expect((await expectProof("stale", await signActionProof(TOKEN, "revoke", now - 120, agent.privateKey, agent.publicJwk), "revoke")).pass).toBe(true);
  });
  it("action proof: a mandate replayed as a proof", async () => {
    expect((await expectProof("mandate as proof", await signJws({ tokenId: TOKEN, purpose: "revoke", iat: now }, "rb-mandate+jwt", agent.privateKey, agent.publicJwk), "revoke")).pass).toBe(true);
  });
  it("demo direct charge off without DEMO_MODE, and against a live base URL", () => {
    record({ id: "guard: DEMO_MODE off", category: "guard", expected: "off", actual: demoEnabled({}) ? "on" : "off" });
    record({ id: "guard: live PayPal base URL", category: "guard", expected: "off", actual: demoEnabled({ DEMO_MODE: "true", PAYPAL_API_BASE: "https://api-m.paypal.com" }) ? "on" : "off" });
    expect(results.filter((r) => r.id.startsWith("guard: ") && !r.pass)).toEqual([]);
  });
  it("spoofed webhook is dropped", async () => {
    const fakeFetch = (async (u: RequestInfo | URL) =>
      String(u).endsWith("/token") ? Response.json({ access_token: "t" }) : Response.json({ verification_status: "FAILURE" })) as typeof fetch;
    const h = new Headers({ "paypal-auth-algo": "a", "paypal-cert-url": "c", "paypal-transmission-id": "i", "paypal-transmission-sig": "s", "paypal-transmission-time": "t" });
    const v = await verifyWebhook(paypalClient(ENV, fakeFetch), h, JSON.stringify({ id: "WH", event_type: "CUSTOMER.DISPUTE.CREATED" }), "WID");
    expect(record({ id: "guard: spoofed webhook", category: "guard", expected: "DROP", actual: v.ok ? "ACCEPT" : "DROP" }).pass).toBe(true);
  });
  it("amount format '65' is not '65.00'", () => {
    expect(record({ id: "guard: amount format variant", category: "guard", expected: "REFUSED", actual: parseCents("65") === null ? "REFUSED" : "PARSED" }).pass).toBe(true);
  });
  it("runtime refuses terms carrying another key", async () => {
    const r = await signReorder(agent, { agreement: TOKEN, terms: formatTerms(baseTerms({ fingerprint: stranger.fingerprint })), sku: "GBP-SR24", qty: 1, unitCents: 6499 }, now);
    expect(record({ id: "guard: runtime refuses foreign fingerprint", category: "guard", expected: "REFUSED", actual: r.ok ? "SIGNED" : "REFUSED" }).pass).toBe(true);
  });
});

export function summarize(results: Outcome[]) {
  const by = (pred: (o: Outcome) => boolean) => {
    const xs = results.filter(pred);
    return { passed: xs.filter((o) => o.pass).length, total: xs.length };
  };
  return {
    scenarios: results.length,
    passed: results.filter((o) => o.pass).length,
    metrics: {
      gateAccuracy: by((o) => o.category === "legitimate" || o.category === "gate-violation" || (o.category === "attack" && o.layer === "gate")),
      attacksBlockedAtRuntime: by((o) => o.category === "attack" && o.layer === "runtime"),
      attacksBlockedAtGate: by((o) => o.category === "attack" && o.layer === "gate"),
      signatureAttacksCaught: by((o) => o.category === "signature"),
      rulingsCorrect: by((o) => o.category === "dispute"),
      // Neutrality (ADR 0004): accuracy reported per side, and wrong suggestions in BOTH directions.
      sellerShouldWin: by((o) => o.category === "dispute" && o.expected === "SELLER_FAVOR"),
      buyerShouldWin: by((o) => o.category === "dispute" && o.expected === "BUYER_FAVOR"),
      noSuggestionDue: by((o) => o.category === "dispute" && o.expected === "none"),
      wrongTowardSeller: results.filter((o) => o.category === "dispute" && o.actual === "SELLER_FAVOR" && o.expected !== "SELLER_FAVOR").length,
      wrongTowardBuyer: results.filter((o) => o.category === "dispute" && o.actual === "BUYER_FAVOR" && o.expected !== "BUYER_FAVOR").length,
      guards: by((o) => o.category === "guard"),
    },
  };
}
