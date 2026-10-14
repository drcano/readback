import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/browser.test.ts", "**/node_modules/**"],
    coverage: {
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "src/fixtures.ts", "src/test-helpers.ts", "src/index.ts"],
      thresholds: { statements: 95, branches: 90 },
    },
  },
});
