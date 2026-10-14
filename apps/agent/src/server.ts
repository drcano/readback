// The agent runtime as a Node HTTP service. Holds AGENT_PRIVATE_KEY and no PayPal credentials.
// Run: pnpm --filter @readback/agent dev   (needs apps/agent/.env)
import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createApp } from "./app.ts";
import { loadAgentKey } from "./key.ts";
import { httpMerchant } from "./merchant.ts";

// Before the agreements exist (pre Oct 21) the runtime still starts: the paths exist but every
// tool refuses, because no real agreement ID can equal the placeholder.
const UNSET = "agreement-not-configured";
const secret = (name: string): string => {
  const v = process.env[name];
  if (!v) console.warn(`${name} not set: generating a random one, so that path is unreachable this run`);
  return v ?? crypto.randomUUID();
};

const app = createApp(
  {
    heroSecret: secret("HERO_MCP_SECRET"),
    heroAgreementId: process.env["HERO_AGREEMENT_ID"] || UNSET,
    judgeSecret: secret("JUDGE_MCP_SECRET"),
    judgeAgreementId: process.env["JUDGE_AGREEMENT_ID"] || UNSET,
  },
  {
    key: await loadAgentKey(process.env["AGENT_PRIVATE_KEY"]),
    merchant: httpMerchant(process.env["MERCHANT_URL"] ?? "http://localhost:3000"),
    now: () => new Date(),
  },
);

const port = Number(process.env["PORT"] ?? 3001);
// Never log request URLs: the MCP paths are secrets (demo-grade access, T20/T29).
createServer(toNodeHandler({ fetch: app })).listen(port, () => console.log(`agent runtime listening on :${port}`));
