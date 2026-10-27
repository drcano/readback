// Lets tests import route handlers, which use Next's "@/..." paths (tsconfig.json).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { exclude: ["e2e/**", "node_modules/**", ".next/**"] },
});
