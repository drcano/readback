import { describe, expect, it } from "vitest";
import { evaluateCase } from "./classify.ts";
import { directCharge, heroCase } from "./fixtures.ts";
import { lights } from "./lights.ts";

describe("four lights", () => {
  it("hero: all four pass; twist: Agent fails, Terms still pass", async () => {
    const hero = await heroCase();
    const states = async (b: Parameters<typeof evaluateCase>[0]) => lights((await evaluateCase(b)).checks).map((l) => `${l.group}:${l.state}`);
    expect(await states(hero.bundle)).toEqual(["Consent:pass", "Agent:pass", "Terms:pass", "Delivery:pass"]);
    expect(await states(directCharge(hero))).toEqual(["Consent:pass", "Agent:fail", "Terms:pass", "Delivery:pass"]);
    expect(await states({ ...hero.bundle, token: null })).toEqual(["Consent:caution", "Agent:pass", "Terms:caution", "Delivery:pass"]);
    expect(await states({ ...hero.bundle, now: "2026-11-08T16:00:00Z" })).toEqual(["Consent:pass", "Agent:caution", "Terms:caution", "Delivery:caution"]);
  });
});
