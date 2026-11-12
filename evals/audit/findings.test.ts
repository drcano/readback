// Audit Oct 25 regression suite (independent review; see docs/decisions/0006-audit-oct25.md).
// Adversarial probes, Oct 25. Each test asserts the HONEST outcome; a failing test is a confirmed finding.
import {
  authorizeCharge,
  type CaseBundle,
  checkFreshness,
  customId,
  evaluateCase,
  formatTerms,
  generateAgentKey,
  sha256Hex,
  verifyMandate,
  buildMandate,
  signMandate,
  type Terms,
} from "@readbackhq/core";
import { heroCase, type HeroCase } from "@readbackhq/core/fixtures";
import { buildCaseBundle, findHistory, paypalClient } from "@readbackhq/verify";
import { fakePayPal } from "@readbackhq/verify/fake";
import { base64url } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { checkout } from "../../apps/web/lib/checkout.ts";

let hero: HeroCase;
beforeAll(async () => {
  hero = await heroCase();
});
const clone = (): CaseBundle => structuredClone(hero.bundle);
const verdict = async (b: CaseBundle) => {
  const r = await evaluateCase(b);
  return { row: r.classification.row, suggestion: r.classification.suggestion, failed: r.failed, msgs: r.checks.filter((c) => !c.pass).map((c) => c.failures.map((f) => f.code)) };
};

describe("F1: a tracker PayPal advanced to DELIVERED reads as 'not shipped'", () => {
  it("NOT_RECEIVED dispute on a delivered order should be row 6 (shipment reported), not BUYER_FAVOR", async () => {
    const b = clone();
    b.dispute!.reason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
    b.order.purchase_units[0]!.shipping!.trackers = [{ id: "TRK-HERO", status: "DELIVERED" }]; // valid Orders v2 tracker_status
    const v = await verdict(b);
    expect(v.suggestion).not.toBe("BUYER_FAVOR");
    expect(v.row).toBe(6);
  });
  it("the hero UNAUTHORISED case stays SELLER_FAVOR once PayPal marks it delivered", async () => {
    const b = clone();
    b.order.purchase_units[0]!.shipping!.trackers = [{ id: "TRK-HERO", status: "DELIVERED" }];
    expect((await verdict(b)).suggestion).toBe("SELLER_FAVOR");
  });
});

describe("F2: gate freshness window has no margin for PayPal's clock (T27 asymmetry)", () => {
  it("the gate stops one skew before exp, so 120 s of PayPal latency and skew still passes check 3", async () => {
    const exp = hero.mandate.exp;
    const at = async (nowSec: number) => (await authorizeCharge({ jws: hero.jws, token: hero.bundle.token, merchant: "Good Boy Provisions", itemName: "x", nowSec })).allow;
    expect(await at(exp)).toBe(false);
    expect(await at(exp - 60)).toBe(true);
    // Accepted at exp − 60; PayPal stamps the capture 120 s later (latency plus its own clock).
    const b = clone();
    b.capture.create_time = new Date((exp + 60) * 1000).toISOString();
    const v = await verdict(b);
    expect(v.msgs.flat()).not.toContain("CAPTURED_OUTSIDE_WINDOW");
    expect(v.suggestion).toBe("SELLER_FAVOR");
  });
  it("gate allows iat = now+60, so PayPal 1 s behind the gate makes check 3 rule against the honest charge", async () => {
    const now = hero.mandate.iat - 60; // the runtime's clock is 60 s ahead of the gate: allowed
    expect(checkFreshness(hero.mandate, now)).toEqual([]);
    const b = clone();
    b.capture.create_time = new Date((now - 1) * 1000).toISOString(); // PayPal's clock 1 s behind the gate's
    const v = await verdict(b);
    expect(v.msgs.flat()).not.toContain("CAPTURED_OUTSIDE_WINDOW");
    expect(v.suggestion).toBe("SELLER_FAVOR");
  });
});

describe("F3: any Transaction Search row that echoes the capture's custom_field is treated as another charge", () => {
  // Non-payment rows are filtered where history is built (findHistory, below), not in the checks.
  it("findHistory passes through T12xx rows and status D rows unfiltered", async () => {
    const fake = fakePayPal();
    const passthrough: typeof fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/v1/reporting/transactions")) {
        return Response.json({
          total_pages: 1,
          transaction_details: [
            { transaction_info: { transaction_id: "CB1", transaction_event_code: "T1201", transaction_status: "S", transaction_initiation_date: "2026-11-09T12:00:00Z", custom_field: "rb1:8kd73hs9ab:0000000000000000:p019:1111111111111111" } },
            { transaction_info: { transaction_id: "DENIED1", transaction_event_code: "T0006", transaction_status: "D", transaction_initiation_date: "2026-11-08T14:59:00Z", custom_field: "rb1:8kd73hs9ab:0000000000000000:p019:2222222222222222" } },
          ],
        });
      }
      return fake.fetch(input, init);
    };
    const pp = paypalClient({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" }, passthrough);
    const h = await findHistory(pp, "8kd73hs9ab", new Date("2026-10-21T00:00:00Z"), new Date("2026-11-10T00:00:00Z"), { checkDisputes: false });
    expect(h.entries.map((e) => e.captureId)).toEqual([]); // neither row is a completed payment
  });
});

describe("F4: 31-day search window seam lists one capture twice", () => {
  it("a capture at exactly start+31d is counted as two verified priors, so check 11 passes with ONE real prior", async () => {
    const fake = fakePayPal();
    const pp = paypalClient({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" }, fake.fetch);
    const agent = await generateAgentKey(true);
    const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: agent.fingerprint };
    const text = formatTerms(terms);
    const th = await sha256Hex(text);
    const TOKEN = "seamtok";
    fake.tokens.set(TOKEN, { id: TOKEN, payment_source: { paypal: { description: text, payer_id: "FAKEPAYER0001" } } });
    const charge = async (iso: string, jti: string) => {
      fake.clock.now = iso;
      const iat = Date.parse(iso) / 1000 - 5;
      const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: TOKEN, terms, termsHash: th }, iat, jti);
      if (!m.ok) throw new Error(m.error.code);
      const r = await checkout(await signMandate(m.value, agent.privateKey, agent.publicJwk), pp, iat + 1);
      if (!r.ok) throw new Error(r.failures.map((f) => f.code).join());
      return r.captureId;
    };
    await charge("2026-11-21T00:00:00.000Z", "jti-seam-0001"); // exactly start + 31 days: the seam between search windows
    const disputed = await charge("2026-12-01T15:00:00Z", "jti-later-0001");
    const lookup = await buildCaseBundle(fake.openDispute(disputed, "UNAUTHORISED"), pp, new Date("2026-12-02T15:00:00Z"));
    if (!lookup.ok) throw new Error(lookup.message);
    const ids = lookup.bundle.history.map((h) => h.captureId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    const v = await verdict(lookup.bundle);
    expect(v.failed).toContain("11"); // one real prior must not satisfy "at least 2"
  });
});

describe("F5: ECDSA malleability — a second valid signature over the same payload", () => {
  const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
  const malleate = (jws: string): string => {
    const [h, p, s] = jws.split(".") as [string, string, string];
    const sig = base64url.decode(s);
    const sInt = BigInt("0x" + Buffer.from(sig.slice(32)).toString("hex"));
    const s2 = (N - sInt).toString(16).padStart(64, "0");
    return `${h}.${p}.${base64url.encode(Buffer.concat([Buffer.from(sig.slice(0, 32)), Buffer.from(s2, "hex")]))}`;
  };
  // (The twin's verification and the invoice block holding are in held.test.ts.)
  it("a malleated twin charged in the next period is caught on its own case (check 3: wrong period, outside the window)", async () => {
    const twin = malleate(hero.jws);
    expect(twin).not.toBe(hero.jws);
    expect((await verifyMandate(twin)).ok).toBe(true);
    const b = clone();
    const pu = b.order.purchase_units[0]!;
    const next = hero.mandate.p + 1;
    pu.items![0]!.description = twin;
    pu.invoice_id = `RB-${b.token!.id}-P${String(next).padStart(3, "0")}`;
    pu.custom_id = customId(b.token!.id, hero.termsHash, next, await sha256Hex(twin));
    b.capture.custom_id = pu.custom_id;
    b.capture.invoice_id = pu.invoice_id;
    b.capture.create_time = "2026-11-09T15:00:00Z";
    b.history.push({ captureId: "CAP-GENUINE", captureTime: "2026-11-08T15:00:00Z", customId: hero.bundle.order.purchase_units[0]!.custom_id, disputed: false, verified: true });
    const v = await verdict(b);
    expect(v.msgs.flat()).toContain("CAPTURED_OUTSIDE_WINDOW");
    expect(v.suggestion).toBe("BUYER_FAVOR");
  });
});
