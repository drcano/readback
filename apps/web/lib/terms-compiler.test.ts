import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { readbackCard } from "./readback-card";
import { compileTerms, validateExtraction } from "./terms-compiler";

const TODAY = "2026-10-21";
const good = { sku: "GBP-SR24", qty: 1, period_days: 30, cap_usd: "65.00", end_date: "2027-03-31", questions: [] as string[] };

// A stand-in for the SDK client: returns whatever "Claude" would have parsed.
const fakeClaude = (parsed: unknown, stop_reason = "end_turn") =>
  ({ beta: { messages: { parse: async () => ({ parsed_output: parsed, stop_reason }) } } }) as unknown as Anthropic;

describe("terms compiler", () => {
  it("turns Claude's extraction into a validated draft and a deterministic card", async () => {
    const r = await compileTerms("Keep Biscuit stocked with the salmon and rice, one bag a month, up to $65, through March.", TODAY, fakeClaude(good));
    expect(r).toEqual({
      ok: true,
      draft: { sku: "GBP-SR24", qty: 1, periodDays: 30, capCents: 6500, end: "2027-03-31" },
      card: "Your agent may buy up to 1 × Salmon & Rice Adult (24 lb) from Good Boy Provisions, once a month (every 30 days), up to $65.00 per order, until Mar 31, 2027. Only your agent can ask; PayPal refuses a second order in the same period.",
      questions: [],
    });
  });

  it("refuses rather than fixes anything off in Claude's proposal", () => {
    const code = (over: Partial<typeof good>) => {
      const r = validateExtraction({ ...good, ...over }, TODAY);
      return r.ok ? "OK" : r.message;
    };
    expect(code({ sku: null as unknown as string })).toMatch(/doesn't match/);
    expect(code({ cap_usd: "65" })).toMatch(/price limit/);
    expect(code({ cap_usd: "0.00" })).toMatch(/price limit/);
    expect(code({ end_date: "2026-10-01" })).toMatch(/end date/);
    expect(code({ end_date: "2027-02-30" })).toMatch(/end date/);
    expect(code({ qty: 0 })).toMatch(/out of range/);
    expect(code({ period_days: 400 })).toMatch(/out of range/);
  });

  it("a refusal or unparseable output becomes a plain-language error", async () => {
    expect((await compileTerms("x x x", TODAY, fakeClaude(null, "refusal"))).ok).toBe(false);
    expect((await compileTerms("x x x", TODAY, fakeClaude(null))).ok).toBe(false);
  });

  it("card wording covers the demo cadence", () => {
    expect(readbackCard({ sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, end: "2027-03-31" })).toContain("once a day");
  });
});
