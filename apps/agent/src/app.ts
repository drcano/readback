// Routes for the agent runtime (SPEC §5.10, apps/agent table). A web-standard fetch handler, so
// tests call it directly and server.ts wraps it for Node. Stateless: a fresh MCP server per request.
import { groupFingerprint } from "@readback/core";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer, type Deps } from "./runtime.ts";

export type AppConfig = {
  heroSecret: string;
  heroAgreementId: string;
  judgeSecret: string;
  judgeAgreementId: string;
};

export function createApp(config: AppConfig, deps: Deps): (req: Request) => Promise<Response> {
  if (config.heroSecret.length < 16 || config.judgeSecret.length < 16) throw new Error("MCP path secrets must be at least 16 characters");
  const routes = new Map([
    // Dante's path: only the hero agreement; can revoke.
    [`/mcp/${config.heroSecret}`, createMcpHandler(() => buildServer({ agreementId: config.heroAgreementId, allowRevoke: true }, { ...deps, judgeAgreementId: config.judgeAgreementId }))],
    // The judge path (in the Devpost instructions): only the judge agreement; no revoke tool.
    [`/mcp/${config.judgeSecret}`, createMcpHandler(() => buildServer({ agreementId: config.judgeAgreementId, allowRevoke: false }, { ...deps, judgeAgreementId: config.judgeAgreementId }))],
  ]);

  return async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/.well-known/agent-key") {
      return Response.json({ jwk: deps.key.publicJwk, fingerprint: deps.key.fingerprint, display: groupFingerprint(deps.key.fingerprint) });
    }
    if (path === "/health") return Response.json({ ok: true });
    const handler = routes.get(path);
    return handler ? handler.fetch(req) : new Response("Not found", { status: 404 });
  };
}
