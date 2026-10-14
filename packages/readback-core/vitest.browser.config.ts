// Runs browser.test.ts inside real headless Chromium, proving readback-core (WebCrypto, jose,
// the eleven checks) works in the browser exactly as in Node (CLAUDE.md §5, SPEC §8 step 9).
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/browser.test.ts"],
    browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }] },
  },
});
