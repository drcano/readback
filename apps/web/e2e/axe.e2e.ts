// Accessibility: axe-core must report zero violations on every page (CLAUDE.md §5).
// Run by e2e/run.ts after the judge flow, against the same server.
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const APP = "http://localhost:3123";
const PAGES: [string, string | null][] = [
  ["/", null],
  ["/shopper", null],
  ["/investigator", "text=PP-D-HERO1"],
  ["/investigator/fixture-hero", "text=Re-checked in your browser"],
  ["/investigator/fixture-twist", "text=Re-checked in your browser"],
  ["/judge", null],
  ["/ap2", "text=Agent's signature on the closed mandate"],
  ["/proposal", "text=Where each line comes from"],
];

const b = await chromium.launch();
let failures = 0;
for (const scheme of ["light", "dark"] as const) {
  const context = await b.newContext({ colorScheme: scheme }); // axe needs an explicit context
  const page = await context.newPage();
  for (const [path, ready] of PAGES) {
    await page.goto(APP + path);
    if (ready) await page.waitForSelector(ready, { timeout: 20_000 });
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    failures += violations.length;
    console.log(`${violations.length ? "FAIL" : "PASS"}  axe ${scheme} ${path}${violations.map((v) => `\n      ${v.id}: ${v.help} (${v.nodes.length})${v.nodes.map((n) => `\n        ${n.target.join(" ")}: ${n.any[0]?.message ?? ""}`).join("")}`).join("")}`);
  }
  await context.close();
}
await b.close();
process.exit(failures ? 1 : 0);
