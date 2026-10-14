// The agent runtime as a Node HTTP service. Holds AGENT_PRIVATE_KEY and no PayPal credentials.
// Run: pnpm --filter @readback/agent dev   (needs apps/agent/.env)
import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createApp } from "./app.ts";
import { loadAgentKey } from "./key.ts";
import { httpMerchant } from "./merchant.ts";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see apps/agent/.env.example)`);
  return v;
};

const app = createApp(
  {
    heroSecret: env("HERO_MCP_SECRET"),
    heroAgreementId: env("HERO_AGREEMENT_ID"),
    judgeSecret: env("JUDGE_MCP_SECRET"),
    judgeAgreementId: env("JUDGE_AGREEMENT_ID"),
  },
  { key: await loadAgentKey(process.env["AGENT_PRIVATE_KEY"]), merchant: httpMerchant(env("MERCHANT_URL")), now: () => new Date() },
);

const port = Number(process.env["PORT"] ?? 3001);
// Never log request URLs: the MCP paths are secrets (demo-grade access, T20/T29).
createServer(toNodeHandler({ fetch: app })).listen(port, () => console.log(`agent runtime listening on :${port}`));
