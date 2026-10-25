import { describe, expect, it } from "vitest";
import { ATTACKS, stoppedAt } from "./lab.ts";

describe("attack lab", () => {
  for (const a of ATTACKS) {
    it(`${a.id} ends at ${a.expect}`, async () => {
      const stops = await a.run();
      expect(stops.map((s) => s.layer)).toEqual(["runtime", "gate", "paypal", "investigator"]);
      expect(stoppedAt(stops)).toBe(a.expect);
    });
  }
});
