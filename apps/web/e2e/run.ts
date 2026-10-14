// pnpm --filter @readback/web test:e2e — builds nothing: run `next build` first.
// Starts the fake PayPal server and `next start` against it, runs the judge-mode e2e, cleans up.
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
  const test = spawn(process.execPath, ["e2e/judge.e2e.ts"], { stdio: "inherit" });
  process.exitCode = await new Promise<number>((resolve) => test.on("exit", (code) => resolve(code ?? 1)));
} finally {
  next.kill();
  fake.kill();
}
