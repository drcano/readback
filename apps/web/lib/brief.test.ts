import type Anthropic from "@anthropic-ai/sdk";
import { evaluateCase } from "@readback/core";
import { directCharge, heroCase } from "@readback/core/fixtures";
import { describe, expect, it } from "vitest";
import { citable, rulesBrief, validate, writeBrief } from "./brief";

// A stand-in for Claude that returns the given drafts in order.
const claudeSays = (...drafts: unknown[]) => {
  let i = 0;
  return { beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: drafts[i++] ?? null }) } } } as unknown as Anthropic;
};

describe("case brief", async () => {
  const hero = await heroCase();
  const heroResult = await evaluateCase(hero.bundle);
  const twist = directCharge(hero);
  const twistResult = await evaluateCase(twist);
  const good = {
    sentences: [
      { text: "The charge was requested and signed by the agent key Maya approved on PayPal.", cites: ["check 3"] },
      { text: "It was within the approved cap, item, period and dates.", cites: ["check 5", "check 6", "check 7", "check 8"] },
      { text: "Two earlier charges under the agreement were never disputed, so the evidence supports seller's favor.", cites: ["check 11", "CAP-HERO"] },
    ],
  };

  it("accepts a fully cited brief consistent with the classification", async () => {
    expect(validate(good, citable(hero.bundle, heroResult), heroResult)).toBeNull();
    expect(await writeBrief(hero.bundle, heroResult, claudeSays(good))).toEqual({ ...good, by: "claude" });
  });

  it("rejects uncited sentences, invented citations, and outcomes the rules didn't reach", () => {
    const allowed = citable(twist, twistResult);
    expect(validate({ sentences: [...good.sentences.slice(0, 2), { text: "Trust me.", cites: [] }] }, allowed, twistResult)).toMatch(/cites nothing/);
    expect(validate({ sentences: [...good.sentences.slice(0, 2), { text: "See the log.", cites: ["check 99"] }] }, allowed, twistResult)).toMatch(/isn't in this case/);
    // On the twist (BUYER_FAVOR), a seller's-favor sentence is refused even if fully cited.
    const sly = { sentences: [good.sentences[0]!, { text: "Terms were respected.", cites: ["check 5"] }, { text: "So the seller's favor is fair.", cites: ["check 5"] }] };
    expect(validate(sly, allowed, twistResult)).toMatch(/suggests seller's favor/);
  });

  it("retries once with the validator's feedback, then falls back to the rules brief", async () => {
    const bad = { sentences: [{ text: "No.", cites: [] }] };
    expect((await writeBrief(twist, twistResult, claudeSays(bad, good))).by).toBe("rules"); // good is wrong for twist too
    expect(await writeBrief(twist, twistResult, null)).toEqual(rulesBrief(twist, twistResult));
  });

  it("the rules brief always validates", () => {
    for (const [b, r] of [[hero.bundle, heroResult], [twist, twistResult]] as const) {
      expect(validate(rulesBrief(b, r), citable(b, r), r)).toBeNull();
    }
  });
});
