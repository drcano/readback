// Seed signer (SPEC §2): reads one reorder request as JSON on stdin, prints {"jws": "..."} or
// {"error": {...}} on stdout. Run in its own process with only AGENT_PRIVATE_KEY in its env, so
// the signer and the charger (`pnpm seed:charge`, which holds PayPal credentials) never share secrets.
import { loadAgentKey } from "./key.ts";
import { ReorderInputSchema, signReorder } from "./sign.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const input = ReorderInputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));

const key = await loadAgentKey(process.env["AGENT_PRIVATE_KEY"]);
const result = await signReorder(key, input, Math.floor(Date.now() / 1000));
process.stdout.write(JSON.stringify(result.ok ? { jws: result.value.jws } : { error: result.error }) + "\n");
if (!result.ok) process.exitCode = 1;
