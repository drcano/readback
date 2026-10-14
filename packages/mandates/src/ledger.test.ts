import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonical.ts";
import { type Clip, GENESIS_HASH, nextClip, verifyChain } from "./ledger.ts";

const at = "2026-10-14T12:00:00Z";

function buildChain(n: number): Clip[] {
  const chain: Clip[] = [];
  for (let i = 0; i < n; i++) {
    chain.push(nextClip(chain, { type: "GATE_ALLOW", refs: { n: String(i) }, reasons: [], timestamp: at }));
  }
  return chain;
}

describe("canonicalize", () => {
  it("is independent of key order, at every depth", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("keeps array order", () => {
    expect(canonicalize([2, 1])).toBe("[2,1]");
  });
});

describe("ledger", () => {
  it("links each clip to the previous hash", () => {
    const chain = buildChain(3);
    expect(chain[0]?.prev_hash).toBe(GENESIS_HASH);
    expect(chain[1]?.prev_hash).toBe(chain[0]?.hash);
    expect(chain.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it("accepts an empty chain", () => {
    expect(verifyChain([])).toEqual({ ok: true });
  });

  it("detects an edited field", () => {
    const chain = buildChain(3);
    chain[1] = { ...chain[1]!, reasons: ["edited"] };
    expect(verifyChain(chain)).toEqual({ ok: false, seq: 1, reason: "hash mismatch" });
  });

  it("detects an edited field with a recomputed hash (breaks the next link)", () => {
    const chain = buildChain(3);
    const forged = nextClip(chain.slice(0, 1), { type: "GATE_DENY", refs: {}, reasons: [], timestamp: at });
    chain[1] = forged;
    expect(verifyChain(chain)).toEqual({ ok: false, seq: 2, reason: "prev_hash mismatch" });
  });

  it("detects a deleted clip", () => {
    const chain = buildChain(3);
    chain.splice(1, 1);
    expect(verifyChain(chain)).toEqual({ ok: false, seq: 1, reason: "seq out of order" });
  });

  it("detects reordering", () => {
    const chain = buildChain(3);
    [chain[1], chain[2]] = [chain[2]!, chain[1]!];
    expect(verifyChain(chain)).toMatchObject({ ok: false, seq: 1 });
  });

  it("rejects unknown fields and bad types (fail closed)", () => {
    const chain: unknown[] = buildChain(1);
    expect(verifyChain([{ ...(chain[0] as Clip), extra: 1 }])).toEqual({ ok: false, seq: 0, reason: "malformed clip" });
    expect(verifyChain([{ ...(chain[0] as Clip), type: "MADE_UP" }])).toMatchObject({ ok: false, seq: 0 });
    expect(verifyChain(["not a clip"])).toMatchObject({ ok: false, seq: 0 });
  });
});
