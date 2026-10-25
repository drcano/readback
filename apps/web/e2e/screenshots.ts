// README screenshots (docs/assets/*.png), taken against the fake PayPal server so they hold no real
// data and can be retaken after any UI change: pnpm --filter @readback/web build && pnpm --filter @readback/web screenshots
import { chromium, type Page } from "playwright";

const APP = "http://localhost:3123";
const OUT = new URL("../../../docs/assets/", import.meta.url);

const SHOTS: { name: string; path: string; ready: string; act?: (p: Page) => Promise<void> }[] = [
  { name: "landing", path: "/", ready: "text=Open the case" },
  { name: "queue", path: "/investigator", ready: "text=PP-D-HERO1" },
  { name: "case-hero", path: "/investigator/fixture-hero", ready: "text=Re-checked in your browser" },
  { name: "case-twist", path: "/investigator/fixture-twist", ready: "text=Re-checked in your browser" },
  { name: "shopper", path: "/shopper", ready: "text=Use the example terms", act: async (p) => { await p.getByRole("button", { name: "Use the example terms" }).click(); await p.getByText("Is this what you mean?").scrollIntoViewIfNeeded(); } },
  { name: "attack-lab", path: "/judge", ready: "text=Stopped at the agent runtime", act: async (p) => { await p.getByRole("button", { name: /^Run all \d+ attacks$/ }).click(); await p.waitForSelector("table >> text=Caught here"); await p.locator(".lab").scrollIntoViewIfNeeded(); } },
  { name: "judge-it-yourself", path: "/judge", ready: "text=Run every scenario", act: async (p) => { await p.getByRole("button", { name: "Run every scenario in my browser" }).click(); await p.waitForSelector("text=scenarios behaved as labeled", { timeout: 60_000 }); } },
];

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", deviceScaleFactor: 1 })).newPage();
for (const s of SHOTS) {
  await page.goto(APP + s.path);
  await page.waitForSelector(s.ready, { timeout: 20_000 });
  if (s.act) await s.act(page);
  await page.screenshot({ path: new URL(`${s.name}.png`, OUT).pathname });
  console.log(`saved docs/assets/${s.name}.png`);
}
await b.close();
