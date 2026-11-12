import type Anthropic from "@anthropic-ai/sdk";
import { evaluateCase } from "@readbackhq/core";
import { directCharge, heroCase } from "@readbackhq/core/fixtures";
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
    expect(validate(sly, allowed, twistResult)).toMatch(/outcome for the seller/);
    const sly2 = { sentences: [good.sentences[0]!, { text: "Terms were respected.", cites: ["check 5"] }, { text: "The merchant should win this one.", cites: ["check 5"] }] };
    expect(validate(sly2, allowed, twistResult)).toMatch(/outcome for the seller/);
    const heroAllowed = citable(hero.bundle, heroResult);
    const sly3 = { sentences: [good.sentences[0]!, good.sentences[1]!, { text: "Still, Maya should be refunded.", cites: ["check 11"] }] };
    expect(validate(sly3, heroAllowed, heroResult)).toMatch(/outcome for the buyer/); // neutrality: both directions
  });

  it("retries once with the validator's feedback, then falls back to the rules brief", async () => {
    const bad = { sentences: [{ text: "No.", cites: [] }] };
    expect((await writeBrief(twist, twistResult, claudeSays(bad, good))).by).toBe("rules"); // good is wrong for twist too
    expect(await writeBrief(twist, twistResult, null)).toEqual(rulesBrief(twist, twistResult));
  });

  // Oct 27: on the hero charge read in preview, Claude wrote "This dispute was filed as unauthorised".
  it("a charge read in preview has no dispute, so no sentence may say one was filed", async () => {
    const preview = await evaluateCase({ ...hero.bundle, dispute: null });
    const filed = { sentences: [{ text: "This dispute was filed as unauthorised, but her agent signed it.", cites: ["check 3"] }, ...good.sentences.slice(1)] };
    expect(validate(filed, citable(hero.bundle, preview), preview)).toMatch(/none was filed/);
    const asIf = { sentences: [{ text: "If she disputed this charge, the evidence shows her agent signed it.", cites: ["check 3"] }, ...good.sentences.slice(1)] };
    expect(validate(asIf, citable(hero.bundle, preview), preview)).toBeNull();
    const hypothetical = { sentences: [{ text: "If a claim were filed as unauthorized, her agent's signature would answer it.", cites: ["check 3"] }, ...good.sentences.slice(1)] };
    expect(validate(hypothetical, citable(hero.bundle, preview), preview)).toBeNull();
    expect(validate(filed, citable(hero.bundle, heroResult), heroResult)).toBeNull(); // a real dispute may say so
  });

  it("the rules brief always validates", () => {
    for (const [b, r] of [[hero.bundle, heroResult], [twist, twistResult]] as const) {
      expect(validate(rulesBrief(b, r), citable(b, r), r)).toBeNull();
    }
  });
});
