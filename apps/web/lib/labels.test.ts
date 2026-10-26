import { readFileSync } from "node:fs";
import { DisputeSchema } from "@readback/core";
import { describe, expect, it } from "vitest";
import { paypalRuling } from "./labels";

describe("paypalRuling", () => {
  it("is null while the dispute is open", () => {
    expect(paypalRuling(undefined, "SELLER_FAVOR")).toBeNull();
  });

  it("reads PayPal's real ruling after the store refunded (sandbox, Oct 26)", () => {
    const real = DisputeSchema.parse(JSON.parse(readFileSync(new URL("../../../evals/fixtures/spike/07-dispute-resolved-after-refund.json", import.meta.url), "utf8")));
    expect(paypalRuling(real.dispute_outcome, "BUYER_FAVOR")).toMatchObject({ favors: "buyer", label: "PayPal ruled for the buyer", reason: "seller issued refund", agrees: true });
  });

  it("leads with PayPal's ruling and says whether Readback's evidence agrees", () => {
    const seller = { outcome_code: "RESOLVED_SELLER_FAVOUR", outcome_reason: "INELIGIBLE_BUYER_PROTECTION_POLICY" };
    expect(paypalRuling(seller, "SELLER_FAVOR")).toMatchObject({ favors: "seller", label: "PayPal ruled for the seller", reason: "ineligible buyer protection policy" });
    expect(paypalRuling(seller, "SELLER_FAVOR")!.check).toMatch(/agrees/);
    expect(paypalRuling(seller, "BUYER_FAVOR")!.check).toMatch(/disagrees: it favors the buyer/);
    expect(paypalRuling({ outcome_code: "RESOLVED_BUYER_FAVOUR" }, "BUYER_FAVOR")!.check).toMatch(/agrees/);
  });

  it("claims nothing when Readback has no recommendation or PayPal's outcome isn't a ruling", () => {
    expect(paypalRuling({ outcome_code: "RESOLVED_SELLER_FAVOUR" }, null)!.check).toMatch(/neither confirms nor questions/);
    const cancelled = paypalRuling({ outcome_code: "CANCELED_BY_BUYER" }, "SELLER_FAVOR")!;
    expect(cancelled).toMatchObject({ favors: null, label: "PayPal closed the case: canceled by buyer", reason: null });
    expect(cancelled.check).toMatch(/isn't a ruling for either side/);
  });
});
