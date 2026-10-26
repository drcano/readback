import { beforeAll, describe, expect, it } from "vitest";
import type { CaseBundle, DisputeReason } from "./case.ts";
import { classify, evaluateCase } from "./classify.ts";
import { directCharge, HERO_CAPTURE_TIME, HERO_TOKEN_ID, type HeroCase, heroCase } from "./fixtures.ts";
import { customId } from "./ids.ts";
import { generateAgentKey, type AgentKey } from "./thumbprint.ts";

let hero: HeroCase;
let attacker: AgentKey;

beforeAll(async () => {
  hero = await heroCase();
  attacker = await generateAgentKey(true);
});

const clone = (): CaseBundle => structuredClone(hero.bundle);
const pu = (b: CaseBundle) => b.order.purchase_units[0]!;
const withReason = (b: CaseBundle, reason: DisputeReason): CaseBundle => ({ ...b, dispute: { ...b.dispute!, reason } });

async function outcome(b: CaseBundle) {
  const r = await evaluateCase(b);
  return { row: r.classification.row, suggestion: r.classification.suggestion, failed: r.failed, notes: r.classification.notes };
}

describe("same claim, two verdicts", () => {
  it("hero: a signed, in-terms charge she disowns → row 13, SELLER_FAVOR", async () => {
    expect(await outcome(hero.bundle)).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR", failed: [] });
  });

  it("hero, as PayPal really shows a disputed capture (PENDING, BUYER_COMPLAINT) → still SELLER_FAVOR", async () => {
    const b = clone();
    b.capture.status = "PENDING";
    b.capture.status_details = { reason: "BUYER_COMPLAINT" };
    expect(await outcome(b)).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR", failed: [] });
  });

  it("a capture pending for any other reason didn't complete → check 4 fails", async () => {
    const b = clone();
    b.capture.status = "PENDING";
    b.capture.status_details = { reason: "PENDING_REVIEW" };
    expect((await outcome(b)).failed).toContain("4");
  });

  it("twist: the merchant charged her wallet directly → row 3, BUYER_FAVOR", async () => {
    const r = await outcome(directCharge(hero));
    expect(r).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
    expect(r.failed).toEqual(expect.arrayContaining(["2b", "3"]));
    expect(r.failed).toEqual(["2b", "3"]); // every term was respected: only the Agent checks fail
  });
});

describe("classification rows", () => {
  it("row 0: out-of-scope reasons get no suggestion", async () => {
    for (const reason of ["CREDIT_NOT_PROCESSED", "PAYMENT_BY_OTHER_MEANS", "PROBLEM_WITH_REMITTANCE", "OTHER"] as const) {
      expect((await outcome(withReason(clone(), reason))).row).toBe(0);
    }
  });

  it("row 1: no vault echo and labels stripped → not an agent-agreement charge", async () => {
    const b = clone();
    delete b.order.purchase_units[0]!.custom_id;
    delete b.order.purchase_units[0]!.invoice_id;
    expect(await outcome(b)).toMatchObject({ row: 1, suggestion: null });
  });

  it("row 1: labels name two different agreements → no link", async () => {
    const b = clone();
    b.order.purchase_units[0]!.invoice_id = "RB-otheragreement-P001";
    expect((await outcome(b)).row).toBe(1);
  });

  it("an echo, when PayPal sends one, links the charge even if the token is gone", async () => {
    const b = clone();
    b.order.payment_source!.paypal!.attributes = { vault: { id: b.token!.id } };
    b.token = null;
    expect((await outcome(b)).row).not.toBe(1);
  });

  it("row 1: the agreement was approved by a different PayPal account", async () => {
    const b = clone();
    b.order.payer = { payer_id: "SOMEONEELSE01" };
    expect(await outcome(b)).toMatchObject({ row: 1, suggestion: null, failed: ["1"] });
  });

  it("row 1: PayPal echoes a different agreement than the one fetched", async () => {
    const b = clone();
    b.order.payment_source!.paypal!.attributes = { vault: { id: "otheragreement" } };
    expect((await outcome(b)).row).toBe(1);
  });

  it("row 2: charged after the agreement was cancelled", async () => {
    const b = clone();
    b.tokenDeletedAt = "2026-11-08T14:00:00Z";
    expect(await outcome(b)).toMatchObject({ row: 2, suggestion: "BUYER_FAVOR" });
  });

  it("row 3: signed by a key Maya never approved", async () => {
    const forged = await heroCase({ agent: hero.agent, signer: attacker });
    expect(await outcome(forged.bundle)).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR", failed: ["3"] });
  });

  it("row 3: mandate tampered after signing", async () => {
    const b = clone();
    const item = pu(b).items![0]!;
    const [h, , s] = item.description!.split(".");
    item.description = `${h}.${btoa(JSON.stringify({ ...hero.mandate, unit: "1.00", amt: "1.00" })).replace(/=+$/, "")}.${s}`;
    expect(await outcome(b)).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
  });

  it("row 3: the same signed request reused for a second charge", async () => {
    const b = clone();
    b.history.push({ captureId: "CAP-REUSE", captureTime: "2026-11-08T15:01:00Z", customId: pu(b).custom_id, disputed: false, verified: false }); // unverified labels still count AGAINST the merchant
    const r = await outcome(b);
    expect(r).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
  });

  it("row 3: captured long after the signed request expired", async () => {
    const b = clone();
    b.capture.create_time = "2026-11-08T15:10:00Z";
    expect((await outcome(b)).row).toBe(3);
  });

  it("row 3: order doesn't match what was signed", async () => {
    const b = clone();
    pu(b).items![0]!.quantity = "2";
    expect((await outcome(b)).row).toBe(3);
  });

  it("row 3: custom_id stripped (invoice_id still names the agreement)", async () => {
    const b = clone();
    delete pu(b).custom_id;
    expect(await outcome(b)).toMatchObject({ row: 3, failed: expect.arrayContaining(["2b"]) });
  });

  it("row 4: the agent signed something over the cap (compromised agent) → outside terms", async () => {
    const over = await heroCase({ agent: hero.agent, mandate: { unit: "70.00", amt: "70.00" } });
    const b = over.bundle;
    pu(b).amount = { currency_code: "USD", value: "70.00", breakdown: { item_total: { currency_code: "USD", value: "70.00" } } };
    pu(b).items![0]!.unit_amount.value = "70.00";
    b.capture.amount.value = "70.00";
    expect(await outcome(b)).toMatchObject({ row: 4, suggestion: "BUYER_FAVOR", failed: ["5"] });
  });

  it("row 4: wrong SKU, signed", async () => {
    const other = await heroCase({ agent: hero.agent, mandate: { sku: "GBP-PREMIUM" } });
    pu(other.bundle).items![0]!.sku = "GBP-PREMIUM";
    expect(await outcome(other.bundle)).toMatchObject({ row: 4, failed: ["6"] });
  });

  it("row 4: unsigned shipping added on top", async () => {
    const b = clone();
    pu(b).amount.breakdown!.shipping = { currency_code: "USD", value: "5.00" };
    expect(await outcome(b)).toMatchObject({ row: 4, failed: ["5"] });
  });

  it("row 4: terms copy on the charge differs from what PayPal holds", async () => {
    const b = clone();
    pu(b).description = hero.termsText.replace("x1/", "x2/");
    expect(await outcome(b)).toMatchObject({ row: 4, failed: ["9"] });
  });

  it("invoice for a different period than signed → buyer favor", async () => {
    const b = clone();
    const inv = `RB-${hero.bundle.token!.id}-P001`;
    pu(b).invoice_id = inv;
    const r = await outcome(b);
    expect(r.suggestion).toBe("BUYER_FAVOR");
  });

  it("row 4: a second charge in the same period (if duplicate blocking were off)", async () => {
    const b = withReason(clone(), "DUPLICATE_TRANSACTION");
    b.history.push({ captureId: "CAP-EARLIER", captureTime: "2026-11-08T09:00:00Z", customId: customId(HERO_TOKEN_ID, hero.termsHash, hero.mandate.p, "9".repeat(64)), disputed: false, verified: false });
    expect(await outcome(b)).toMatchObject({ row: 4, suggestion: "BUYER_FAVOR", failed: ["7"] });
  });

  it("rows 5/6: not received, with and without a tracker", async () => {
    const b = withReason(clone(), "MERCHANDISE_OR_SERVICE_NOT_RECEIVED");
    expect(await outcome(b)).toMatchObject({ row: 6, suggestion: null });
    pu(b).shipping!.trackers = [];
    expect(await outcome(b)).toMatchObject({ row: 5, suggestion: "BUYER_FAVOR" });
  });

  it("rows 7–10: reason-specific outcomes", async () => {
    expect((await outcome(withReason(clone(), "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"))).row).toBe(7);
    expect(await outcome(withReason(clone(), "INCORRECT_AMOUNT"))).toMatchObject({ row: 8, suggestion: "SELLER_FAVOR" });
    // Rows 9 and 10 make no suggestion: "no other charge" and "before she cancelled" would be
    // inferred from what Readback can't see (unlabeled charges; PayPal's cancellation record). Audit Oct 25.
    expect(await outcome(withReason(clone(), "DUPLICATE_TRANSACTION"))).toMatchObject({ row: 9, suggestion: null });
    expect(await outcome(withReason(clone(), "CANCELED_RECURRING_BILLING"))).toMatchObject({ row: 10, suggestion: null });
  });

  it("the history threshold guards every seller-favor row, not only unauthorized (audit Oct 25)", async () => {
    const b = withReason(clone(), "INCORRECT_AMOUNT");
    b.history = [];
    expect(await outcome(b)).toMatchObject({ row: 8, suggestion: null, failed: ["11"] });
  });

  it("row 11: shipped to an address she didn't approve", async () => {
    const b = clone();
    pu(b).shipping!.address = { ...pu(b).shipping!.address, postal_code: "99999" };
    expect(await outcome(b)).toMatchObject({ row: 11, suggestion: null, failed: ["10"] });
  });

  it("row 12: not enough history → consent authenticity unverified", async () => {
    const b = clone();
    b.history = b.history.filter((h) => h.captureId !== "CAP-PRIOR-1");
    expect(await outcome(b)).toMatchObject({ row: 12, suggestion: null, failed: ["11"] });
  });

  it("row 12: prior charges that were themselves disputed don't count", async () => {
    const b = clone();
    b.history[0]!.disputed = true;
    expect((await outcome(b)).row).toBe(12);
  });

  it("row 12: history too recent (earliest under 7 days)", async () => {
    const b = clone();
    b.history[0]!.captureTime = "2026-11-03T15:00:00Z";
    b.history[1]!.captureTime = "2026-11-05T15:00:00Z";
    expect((await outcome(b)).row).toBe(12);
  });
});

describe("audit regressions (independent review, Oct 15)", () => {
  it("finding 1: token present but without terms; merchant-written terms on the order don't count", async () => {
    const attacker = await generateAgentKey(true);
    const forged = await heroCase({ agent: attacker }); // order terms + mandate carry the MERCHANT's key
    const b = forged.bundle;
    b.token = { id: b.token!.id, payment_source: { paypal: { payer_id: "FAKEPAYER0001" } } }; // an ordinary saved wallet: no description
    for (const reason of ["UNAUTHORISED", "INCORRECT_AMOUNT", "DUPLICATE_TRANSACTION"] as const) {
      expect(await outcome(withReason(b, reason))).toMatchObject({ row: 1, suggestion: null });
    }
  });

  it("finding 2: labeled history the merchant padded (unverified) can't lift a case to seller's favor", async () => {
    const b = clone();
    b.history = b.history.map((h) => (h.captureId === "CAP-HERO" ? h : { ...h, verified: false }));
    expect(await outcome(b)).toMatchObject({ row: 12, suggestion: null });
  });

  it("finding 3: an incomplete history search makes the case provisional (no seller-favor suggestion)", async () => {
    const b = { ...clone(), historyComplete: false };
    const r = await outcome(b);
    expect(r.suggestion).toBeNull();
    expect(r.notes.join(" ")).toMatch(/Provisional/);
    // Buyer-favor results are unaffected by missing history.
    expect((await outcome({ ...directCharge(hero), historyComplete: false })).suggestion).toBe("BUYER_FAVOR");
  });
});

describe("modifiers only ever withhold a seller-favor suggestion", () => {
  it("agreement deleted → secondary terms → no suggestion", async () => {
    const b = clone();
    b.token = null;
    const r = await outcome(b);
    expect(r).toMatchObject({ row: 13, suggestion: null });
    expect(r.notes.join(" ")).toMatch(/merchant-attested/);
  });

  it("secondary terms never rescue a buyer-favor result", async () => {
    const b = directCharge(hero);
    b.token = null;
    expect(await outcome(b)).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
  });

  it("under 3 hours old → provisional → no suggestion", async () => {
    const b = clone();
    b.now = "2026-11-08T16:00:00Z";
    const r = await outcome(b);
    expect(r).toMatchObject({ row: 13, suggestion: null });
    expect(r.notes.join(" ")).toMatch(/Provisional/);
  });
});

describe("preview mode (a capture with no dispute)", () => {
  it("is read as UNAUTHORISED, 'if disputed'", async () => {
    const r = await evaluateCase({ ...clone(), dispute: null });
    expect(r).toMatchObject({ mode: "preview", reason: "UNAUTHORISED", classification: { row: 13 } });
  });

  it("a judge's fresh charge has no history yet → no suggestion", async () => {
    const b = { ...clone(), dispute: null, history: [] };
    expect((await outcome(b)).row).toBe(12);
  });

  it("the dishonest-merchant charge is red in preview too", async () => {
    expect(await outcome({ ...directCharge(hero), dispute: null })).toMatchObject({ row: 3, suggestion: "BUYER_FAVOR" });
  });
});

describe("classify table order", () => {
  it("first match wins: revocation outranks a missing signature", () => {
    expect(classify("UNAUTHORISED", new Set(["4", "3"])).row).toBe(2);
    expect(classify("UNAUTHORISED", new Set(["1", "4"])).row).toBe(1);
    expect(classify("OTHER", new Set(["1"])).row).toBe(0);
  });
});

it("hero fixture is internally consistent", () => {
  expect(hero.bundle.capture.create_time).toBe(HERO_CAPTURE_TIME);
  expect(hero.jws.length).toBeLessThan(700);
});

describe("fixture set", () => {
  it("covers distinct rows and labels each one", async () => {
    const { fixtureCases } = await import("./fixtures.ts");
    const rows = await Promise.all((await fixtureCases()).map(async (f) => [f.id, (await evaluateCase(f.bundle)).classification] as const));
    expect(Object.fromEntries(rows.map(([id, c]) => [id, `${c.row}:${c.suggestion}`]))).toEqual({
      "PP-D-HERO1": "13:SELLER_FAVOR",
      "PP-D-TWIST": "3:BUYER_FAVOR",
      "PP-D-FX-REVOKED": "2:BUYER_FAVOR",
      "PP-D-FX-NOTRECEIVED": "5:BUYER_FAVOR",
      "PP-D-FX-NEWAGREEMENT": "12:null",
      "PP-D-FX-DELETED": "13:null",
    });
  });
});
