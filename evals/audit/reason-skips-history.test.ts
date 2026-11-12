// Audit Oct 25: the history threshold (check 11, the brake on T21 "merchant swapped in its own key")
// guards every seller-favor row, whatever reason the buyer files under.
import { evaluateCase, type DisputeReason } from "@readbackhq/core";
import { heroCase } from "@readbackhq/core/fixtures";
import { describe, expect, it } from "vitest";

describe("history threshold applies to every dispute reason", () => {
  it.each(["INCORRECT_AMOUNT", "DUPLICATE_TRANSACTION", "CANCELED_RECURRING_BILLING"] as DisputeReason[])(
    "first-ever charge, no history, reason %s → no suggestion",
    async (reason) => {
      const hero = await heroCase();
      const b = structuredClone(hero.bundle);
      b.history = b.history.filter((h) => h.captureId === "CAP-HERO");
      b.dispute!.reason = reason;
      const unauth = await evaluateCase({ ...structuredClone(b), dispute: { ...b.dispute!, reason: "UNAUTHORISED" } });
      expect(unauth.classification).toMatchObject({ row: 12, suggestion: null }); // control: withheld
      const r = await evaluateCase(b);
      expect(r.failed).toContain("11");
      expect(r.classification.suggestion).toBeNull();
    },
  );
});
