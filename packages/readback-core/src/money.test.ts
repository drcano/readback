import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatCents, parseCents } from "./money.ts";

describe("money", () => {
  it("parses canonical amounts into integer cents", () => {
    expect(parseCents("64.99")).toBe(6499);
    expect(parseCents("0.05")).toBe(5);
    expect(parseCents("9999.99")).toBe(999_999);
  });

  it("refuses non-canonical or out-of-range amounts (fail closed)", () => {
    for (const bad of ["65", "65.0", "065.00", "10000.00", "-1.00", "1,000.00", " 1.00", "1.00 ", "1e2", ""]) {
      expect(parseCents(bad), bad).toBeNull();
    }
  });

  it("round-trips every cent value", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999_999 }), (c) => parseCents(formatCents(c)) === c));
  });
});
