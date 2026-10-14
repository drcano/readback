// Runs the eval scenarios under vitest (CI), adds the server-only ones, and writes
// evals/results/latest.json. The same scenarios run in the browser at /judge.
import { writeFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { isAdmin } from "../apps/web/lib/admin.ts";
import { type Outcome, runScenarios, summarize } from "./scenarios.ts";
import { tamperSample } from "./tamper.ts";

const results: Outcome[] = await runScenarios();

// Server-only (uses node:crypto), so it isn't in the browser set.
const req = new Request("https://x/api/cases/1/actions", { method: "POST" });
const adminAllowed = isAdmin(req, { MERCHANT_ADMIN_TOKEN: "s".repeat(32) });
results.push({ id: "guard: merchant action without admin token", category: "guard", expected: "DENY", actual: adminAllowed ? "ALLOW" : "DENY", pass: !adminAllowed });

it.each(results.map((r) => [r.id, r] as const))("%s", (_id, r) => {
  expect(r.actual).toBe(r.expected);
});

const tamper = await tamperSample(2000, 1);
it("tamper sample: no mutated hero case keeps SELLER_FAVOR", () => {
  expect(tamper.kept).toBe(0);
});

afterAll(() => {
  const report = { ...summarize(results), tamperSample: tamper, results };
  writeFileSync(new URL("./results/latest.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
});
