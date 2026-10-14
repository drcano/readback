// The agent's private key. It lives only in this runtime's environment (AGENT_PRIVATE_KEY):
// never sent to Claude, never in a tool result, never logged, never in apps/web (CLAUDE.md §5).
// Format: a P-256 private JWK as one line of JSON, e.g. {"kty":"EC","crv":"P-256","x":"…","y":"…","d":"…"}.
import { agentFingerprint, type AgentKey, PublicJwkSchema } from "@readback/core";
import { importJWK } from "jose";
import { z } from "zod";

const PrivateJwkSchema = PublicJwkSchema.extend({ d: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function loadAgentKey(envValue: string | undefined): Promise<AgentKey> {
  if (!envValue) throw new Error("AGENT_PRIVATE_KEY is not set (run `pnpm --filter @readback/agent keygen` once).");
  let parsed: unknown;
  try {
    parsed = JSON.parse(envValue);
  } catch {
    throw new Error("AGENT_PRIVATE_KEY is not valid JSON."); // never echo the value itself
  }
  const jwk = PrivateJwkSchema.safeParse(parsed);
  if (!jwk.success) throw new Error("AGENT_PRIVATE_KEY is not a P-256 private JWK.");
  const { d: _d, ...pub } = jwk.data;
  const privateKey = await importJWK(jwk.data, "ES256");
  if (privateKey instanceof Uint8Array) throw new Error("AGENT_PRIVATE_KEY is not an EC key.");
  return { privateKey, publicJwk: pub, fingerprint: await agentFingerprint(pub) };
}
