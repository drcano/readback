import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { include: ["src/**"], exclude: ["src/test-fixtures.ts", "src/index.ts"] },
  },
});
