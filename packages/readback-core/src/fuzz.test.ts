// Property-based tamper fuzzing (SPEC §10): mutate any field the checks read in the hero case.
// A mutated case must never still earn SELLER_FAVOR. The report counts are printed for the README.
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { type CaseBundle, CaseBundleSchema } from "./case.ts";
import { evaluateCase } from "./classify.ts";
import { type HeroCase, heroCase } from "./fixtures.ts";
import { verifyMandate } from "./mandate.ts";

let hero: HeroCase;
beforeAll(async () => {
  hero = await heroCase();
});

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.:| ";
const flip = (s: string, i: number, ch: string) => s.slice(0, i % s.length) + ch + s.slice((i % s.length) + 1);
const pu = (b: CaseBundle) => b.order.purchase_units[0]!;

type Mutation = { field: string; apply: (b: CaseBundle) => void };

// One arbitrary per field the checks read. Each produces a *different* value.
const mutations: fc.Arbitrary<Mutation> = fc.oneof(
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "token.description (terms)", apply: (b) => { b.token!.payment_source.paypal.description = flip(b.token!.payment_source.paypal.description!, i, ch); } })),
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "order terms copy", apply: (b) => { pu(b).description = flip(pu(b).description!, i, ch); } })),
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "items[0].description (JWS)", apply: (b) => { pu(b).items![0]!.description = flip(pu(b).items![0]!.description!, i, ch); } })),
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "custom_id", apply: (b) => { pu(b).custom_id = flip(pu(b).custom_id!, i, ch); } })),
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "invoice_id", apply: (b) => { pu(b).invoice_id = flip(pu(b).invoice_id!, i, ch); } })),
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "vault.id", apply: (b) => { const v = b.order.payment_source!.paypal!.attributes!.vault!; v.id = flip(v.id!, i, ch); } })),
  fc.tuple(fc.nat(), fc.constantFrom(...ALPHABET)).map(([i, ch]): Mutation => ({ field: "payer_id", apply: (b) => { b.order.payer!.payer_id = flip(b.order.payer!.payer_id!, i, ch); } })),
  fc.integer({ min: 1, max: 999_999 }).map((c): Mutation => ({ field: "amount.value", apply: (b) => { pu(b).amount.value = (c / 100).toFixed(2); } })),
  fc.integer({ min: 1, max: 999_999 }).map((c): Mutation => ({ field: "capture.amount", apply: (b) => { b.capture.amount.value = (c / 100).toFixed(2); } })),
  fc.integer({ min: 1, max: 999_999 }).map((c): Mutation => ({ field: "unit_amount", apply: (b) => { pu(b).items![0]!.unit_amount.value = (c / 100).toFixed(2); } })),
  fc.integer({ min: 1, max: 999_999 }).map((c): Mutation => ({ field: "breakdown.item_total", apply: (b) => { pu(b).amount.breakdown!.item_total!.value = (c / 100).toFixed(2); } })),
  fc.integer({ min: 1, max: 9_999 }).map((c): Mutation => ({ field: "breakdown.shipping", apply: (b) => { pu(b).amount.breakdown!.shipping = { currency_code: "USD", value: (c / 100).toFixed(2) }; } })),
  fc.stringMatching(/^[A-Z0-9-]{1,16}$/).map((sku): Mutation => ({ field: "items[0].sku", apply: (b) => { pu(b).items![0]!.sku = sku; } })),
  fc.integer({ min: 0, max: 1000 }).map((q): Mutation => ({ field: "items[0].quantity", apply: (b) => { pu(b).items![0]!.quantity = String(q); } })),
  fc.integer({ min: 400, max: 400 * 86_400 }).chain((d) => fc.constantFrom(d, -d)).map((d): Mutation => ({
    field: "capture.create_time",
    apply: (b) => { b.capture.create_time = new Date(Date.parse(b.capture.create_time) + d * 1000).toISOString(); },
  })),
  fc.constant<Mutation>({ field: "tracker status", apply: (b) => { pu(b).shipping!.trackers![0]!.status = "CANCELLED"; } }),
  fc.constant<Mutation>({ field: "tracker removed", apply: (b) => { pu(b).shipping!.trackers = []; } }),
  fc.constant<Mutation>({ field: "token deleted before capture", apply: (b) => { b.tokenDeletedAt = "2026-11-08T14:59:00Z"; } }),
  fc.constant<Mutation>({ field: "mandate stripped", apply: (b) => { delete pu(b).items![0]!.description; } }),
);

describe("tamper fuzzing", () => {
  it("the hero bundle parses with the case schema", () => {
    expect(CaseBundleSchema.parse(hero.bundle)).toEqual(hero.bundle);
    expect(CaseBundleSchema.safeParse({ ...hero.bundle, capture: undefined }).success).toBe(false);
  });

  it("no single mutation of a field the checks read still earns SELLER_FAVOR (property)", async () => {
    const original = JSON.stringify(hero.bundle);
    let caught = 0;
    let unchanged = 0;
    await fc.assert(
      fc.asyncProperty(mutations, async (m) => {
        const b = structuredClone(hero.bundle);
        m.apply(b);
        if (JSON.stringify(b) === original) { unchanged++; return true; }
        // A JWS char flip in base64url padding bits can decode to the identical signed bytes;
        // that's the same mandate, not a tamper.
        const jws = pu(b).items![0]!.description;
        if (m.field.includes("JWS") && jws) {
          const v = await verifyMandate(jws);
          if (v.ok && JSON.stringify(v.value.payload) === JSON.stringify(hero.mandate)) { unchanged++; return true; }
        }
        const r = await evaluateCase(b);
        if (r.classification.suggestion === "SELLER_FAVOR") return false;
        caught++;
        return true;
      }),
      { numRuns: 10_000 }, // SPEC §10 asks for the catch rate over 10,000 mutations
    );
    expect(caught + unchanged).toBe(10_000);
    expect(unchanged).toBeLessThan(500); // nearly every mutation really changed something
  });
});
