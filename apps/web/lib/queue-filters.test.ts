import { evaluateCase, lights } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";
import { describe, expect, it } from "vitest";
import { answer, FILTERS, keywordFilter } from "./queue-filters";
import type { QueueRow } from "./queue";
import { pickFilter } from "./studio-agent";
import type Anthropic from "@anthropic-ai/sdk";

async function rows(): Promise<QueueRow[]> {
  return Promise.all(
    (await fixtureCases()).map(async (f) => {
      const r = await evaluateCase(f.bundle);
      return {
        id: f.id, href: "", source: "Fixture" as const, note: f.label, reason: r.reason, stage: "", amount: 0, due: null,
        classification: r.classification.label, row: r.classification.row, suggestion: r.classification.suggestion,
        failed: r.failed.join(", "), lights: lights(r.checks), evidence: r.facts.secondaryTerms ? ("Merchant copy (secondary)" as const) : ("PayPal terms" as const),
      };
    }),
  );
}

describe("queue questions", () => {
  it("answers the spec's example questions deterministically", async () => {
    const all = await rows();
    const ids = (id: keyof typeof FILTERS) => all.filter(FILTERS[id].match).map((r) => r.id).sort();
    expect(ids("merchant_should_lose")).toEqual(["PP-D-FX-NOTRECEIVED", "PP-D-FX-REVOKED", "PP-D-TWIST"]);
    expect(ids("consent_unverified")).toEqual(["PP-D-FX-NEWAGREEMENT"]);
    expect(ids("failed_only_delivery")).toEqual(["PP-D-FX-NEWAGREEMENT", "PP-D-FX-NOTRECEIVED"]);
    expect(ids("agent_failed")).toEqual(["PP-D-TWIST"]);
    expect(answer("merchant_should_lose", all).text).toBe("3 of 6: cases the merchant should lose (suggested buyer's favor).");
  });

  it("falls back to keywords without Claude", async () => {
    expect(keywordFilter("cases the merchant should lose")).toBe("merchant_should_lose");
    expect(keywordFilter("which cases should the merchant lose?")).toBe("merchant_should_lose");
    expect(keywordFilter("where does the merchant win")).toBe("merchant_should_win");
    expect(keywordFilter("failed only on delivery")).toBe("failed_only_delivery");
    expect(keywordFilter("consent unverified")).toBe("consent_unverified");
    expect(await pickFilter("show me everything", null)).toEqual({ filter: "all", via: "keywords" });
  });

  it("uses Claude's choice when it's one of the named filters", async () => {
    const claude = { beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: { filter: "agent_failed" } }) } } } as unknown as Anthropic;
    expect(await pickFilter("which charges did no agent ask for?", claude)).toEqual({ filter: "agent_failed", via: "claude" });
  });
});
