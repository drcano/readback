// Generates the agent's permanent P-256 key ONCE and prints it to the terminal. Nothing is written
// to disk. Copy the JSON into apps/agent/.env as AGENT_PRIVATE_KEY (and later into Render's secret
// env for the agent service). The fingerprint is what Maya approves on PayPal's page.
// Run: pnpm --filter @readback/agent keygen
import { generateAgentKey, groupFingerprint } from "@readbackhq/core";
import { exportJWK } from "jose";

const key = await generateAgentKey(true);
const { kty, crv, x, y, d } = await exportJWK(key.privateKey);

console.log("Agent fingerprint (what PayPal's approval page must show):");
console.log(`  ${groupFingerprint(key.fingerprint)}\n`);
console.log("Put this line in apps/agent/.env. Treat it like a password; it is shown only now:");
console.log(`AGENT_PRIVATE_KEY=${JSON.stringify({ kty, crv, x, y, d })}`);
