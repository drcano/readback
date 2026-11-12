import { evaluateCase } from "@readbackhq/core";
import { directCharge, fixtureCases, heroCase } from "@readbackhq/core/fixtures";
import { describe, expect, it } from "vitest";
import { draftMessage } from "./inquiry";

describe("dispute drafts", () => {
  it("hero: reads Maya's own approval back to her", async () => {
    const hero = await heroCase();
    const d = draftMessage(hero.bundle, await evaluateCase(hero.bundle));
    expect(d.kind).toBe("inquiry");
    expect(d.text).toContain("active from Oct 21, 2026");
    expect(d.text).toContain("up to 1 × Salmon & Rice Adult (24 lb) once a day, up to $65.00 per order, until Mar 31, 2027");
    expect(d.text).toContain("signed by that agent on Nov 8, 2026. It was charge 3 under that agreement.");
    expect(d.text).toMatch(/Manage automatic payments/);
  });

  it("twist: a refund note, against the merchant", async () => {
    const hero = await heroCase();
    const twist = directCharge(hero);
    const d = draftMessage(twist, await evaluateCase(twist));
    expect(d).toEqual({ kind: "refund", text: "We're sorry. We reviewed this charge (CAP-DIRECT, USD 59.00): it wasn't requested by your agent. We'll refund it in full." });
  });

  it("no suggestion: no draft", async () => {
    const fx = (await fixtureCases()).find((f) => f.id === "PP-D-FX-NEWAGREEMENT")!;
    expect(draftMessage(fx.bundle, await evaluateCase(fx.bundle)).kind).toBe("none");
  });
});
