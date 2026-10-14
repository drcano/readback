// Prints the agent's PUBLIC key and fingerprint (safe to share). The merchant needs the
// fingerprint to build terms; later the runtime serves the same thing at /.well-known/agent-key.
// Run: pnpm --filter @readback/agent pubkey
import { groupFingerprint } from "@readback/core";
import { loadAgentKey } from "./key.ts";

const key = await loadAgentKey(process.env["AGENT_PRIVATE_KEY"]);
console.log(JSON.stringify({ jwk: key.publicJwk, fingerprint: key.fingerprint }));
console.error(`fingerprint: ${groupFingerprint(key.fingerprint)}`);
