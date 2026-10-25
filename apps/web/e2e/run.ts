// pnpm --filter @readback/web test:e2e — builds nothing: run `next build` first.
// Starts the fake PayPal server and `next start` against it, runs the given scripts (default: the
// judge-mode e2e and axe), cleans up. `pnpm --filter @readback/web screenshots` reuses it for docs/assets.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const fake = spawn(process.execPath, ["e2e/fake-paypal-server.ts", "4555"], { stdio: "ignore" });
const next = spawn("npx", ["next", "start", "-p", "3123"], {
  stdio: "ignore",
  env: { ...process.env, PAYPAL_API_BASE: "http://localhost:4555", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", NEXT_TELEMETRY_DISABLED: "1" },
});
try {
  for (let i = 0; i < 30; i++) {
    if (await fetch("http://localhost:3123/api/health").then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  const run = (file: string) =>
    new Promise<number>((resolve) => spawn(process.execPath, [file], { stdio: "inherit" }).on("exit", (code) => resolve(code ?? 1)));
  const files = process.argv.length > 2 ? process.argv.slice(2) : ["e2e/judge.e2e.ts", "e2e/axe.e2e.ts"];
  for (const file of files) process.exitCode = (await run(file)) || process.exitCode;
} finally {
  next.kill();
  fake.kill();
}
