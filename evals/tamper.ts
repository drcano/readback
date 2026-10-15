// A seeded tamper sample: mutate one field the checks read in the hero case and count how many
// mutated cases still earn SELLER_FAVOR (target: none). Browser-safe, no test framework, so the
// "Judge it yourself" page can run it live. The 10,000-run property test with shrinking is in
// packages/readback-core/src/fuzz.test.ts.
import { type CaseBundle, evaluateCase, verifyMandate } from "@readback/core";
import { heroCase } from "@readback/core/fixtures";

// mulberry32: a tiny deterministic PRNG, so a seed reproduces the same mutation choices. The hero
// case is re-signed each run (fresh key, randomized ECDSA), so a few flips land as no-ops on some
// runs and not others: caught/unchanged drift by a handful; kept must be 0 every time.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.:| ";

export async function tamperSample(n: number, seed: number) {
  const hero = await heroCase();
  const r = rng(seed);
  const int = (max: number) => Math.floor(r() * max);
  const flip = (s: string) => {
    const i = int(s.length);
    return s.slice(0, i) + CHARS[int(CHARS.length)] + s.slice(i + 1);
  };
  const pu = (b: CaseBundle) => b.order.purchase_units[0]!;
  const money = () => (int(999_999) / 100 + 0.01).toFixed(2);
  const mutations: ((b: CaseBundle) => void)[] = [
    (b) => { b.token!.payment_source.paypal.description = flip(b.token!.payment_source.paypal.description!); },
    (b) => { pu(b).description = flip(pu(b).description!); },
    (b) => { pu(b).items![0]!.description = flip(pu(b).items![0]!.description!); },
    (b) => { pu(b).custom_id = flip(pu(b).custom_id!); },
    (b) => { pu(b).invoice_id = flip(pu(b).invoice_id!); },
    (b) => { const p = b.token!.payment_source.paypal; p.payer_id = flip(p.payer_id!); },
    (b) => { b.order.payer!.payer_id = flip(b.order.payer!.payer_id!); },
    (b) => { pu(b).amount.value = money(); },
    (b) => { b.capture.amount.value = money(); },
    (b) => { pu(b).items![0]!.unit_amount.value = money(); },
    (b) => { pu(b).items![0]!.quantity = String(int(1000)); },
    (b) => { pu(b).items![0]!.sku = flip(pu(b).items![0]!.sku!); },
    (b) => { b.capture.create_time = new Date(Date.parse(b.capture.create_time) + (r() < 0.5 ? -1 : 1) * (400 + int(30 * 86_400)) * 1000).toISOString(); },
    (b) => { pu(b).shipping!.trackers![0]!.status = "CANCELLED"; },
    (b) => { b.tokenDeletedAt = "2026-11-08T14:59:00Z"; },
  ];

  const original = JSON.stringify(hero.bundle);
  let caught = 0;
  let unchanged = 0;
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const b = structuredClone(hero.bundle);
    mutations[int(mutations.length)]!(b);
    if (JSON.stringify(b) === original) { unchanged++; continue; }
    const jws = pu(b).items![0]!.description;
    if (jws && jws !== hero.jws) {
      const v = await verifyMandate(jws);
      // A flipped padding bit can decode to the identical signed bytes: same mandate, not a tamper.
      if (v.ok && JSON.stringify(v.value.payload) === JSON.stringify(hero.mandate) && v.value.fingerprint === hero.agent.fingerprint) { unchanged++; continue; }
    }
    if ((await evaluateCase(b)).classification.suggestion === "SELLER_FAVOR") kept++;
    else caught++;
  }
  return { mutations: n, caught, kept, unchanged, seed };
}
