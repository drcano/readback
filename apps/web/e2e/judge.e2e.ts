// End to end: real Next.js server + fake PayPal over HTTP + real Chromium.
// Judge mode step 1 (key in the tab, PayPal popup, postMessage back) and step 2 (sign in the
// browser, gate verifies, charge) and the case view in preview mode.
// Run: node e2e/judge.e2e.ts   (expects the app on :3123 with PAYPAL_API_BASE=http://localhost:4555)
import { chromium } from "playwright";

const APP = "http://localhost:3123";
const b = await chromium.launch();
const page = await b.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

// The popup would open PayPal's real site. Intercept it: approve in the fake, then follow
// PayPal's return redirect back to our return route, exactly as PayPal would.
await page.context().route("https://www.sandbox.paypal.com/**", async (route) => {
  const setupId = new URL(route.request().url()).searchParams.get("approval_session_id")!;
  await fetch(`http://localhost:4555/__approve/${setupId}`);
  await route.fulfill({ status: 302, headers: { location: `${APP}/api/agreements/return?flow=judge&approval_token_id=${setupId}` } });
});

await page.goto(APP);
await page.getByRole("button", { name: "Create my key and approve on PayPal" }).click();
await page.waitForSelector("text=Approved on PayPal", { timeout: 20_000 });
const fp = await page.textContent(".fp");
console.log("PASS  step 1: approved via popup; tab key fingerprint", fp);

await page.getByRole("button", { name: "Sign and buy one bag" }).click();
await page.waitForSelector("text=Charged.", { timeout: 20_000 });
console.log("PASS  step 2: tab signed, gate verified, charged");

await page.getByRole("link", { name: "Check this charge" }).first().click();
await page.waitForSelector("text=Re-checked in your browser", { timeout: 20_000 });
const verdict = await page.textContent(".rec-banner");
// A fresh judge charge has no tracker and no history: a no-suggestion row (11 or 12), never a verdict.
const ok = /Needs review/.test(verdict ?? "");
console.log(`${ok ? "PASS" : "FAIL"}  step 4: own charge in preview has no suggestion yet — ${verdict?.replace(/\s+/g, " ").slice(0, 120)}`);
console.log(errors.length ? `FAIL  page errors: ${errors.join(" | ")}` : "PASS  no page errors");
await b.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
