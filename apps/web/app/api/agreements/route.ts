// POST /api/agreements — Public; rate-limited (SPEC §5.10). Starts a PayPal approval.
// Body: { flow: "maya" | "judge", draft: {...}, jwk?: <judge tab's public key> }.
// Maya's agent key is fetched from AGENT_RUNTIME_URL only (never a URL from the body).
import { PublicJwkSchema } from "@readbackhq/core";
import { z } from "zod";
import { createAgreement, DraftSchema, fetchAgentKey, publicOrigin } from "@/lib/agreements";
import { allowAgreement, clientIp } from "@/lib/budget";
import { paypalClient } from "@/lib/paypal/client";

const Body = z.discriminatedUnion("flow", [
  z.strictObject({ flow: z.literal("maya"), draft: DraftSchema }),
  z.strictObject({ flow: z.literal("judge"), draft: DraftSchema, jwk: PublicJwkSchema }),
]);

export async function POST(req: Request): Promise<Response> {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, failure: { code: "BAD_REQUEST", message: "Invalid agreement request." } }, { status: 400 });
  const gate = allowAgreement(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, failure: { code: "RATE_LIMITED", message: gate.message } }, { status: 429 });
  const jwk = body.data.flow === "judge" ? body.data.jwk : await fetchAgentKey(process.env["AGENT_RUNTIME_URL"] ?? "");
  if (!jwk) return Response.json({ ok: false, failure: { code: "AGENT_UNREACHABLE", message: "Your agent runtime didn't answer with its key." } }, { status: 502 });
  const result = await createAgreement(paypalClient(), body.data.draft, jwk, {
    today: new Date().toISOString().slice(0, 10), // agreements start today, UTC
    baseUrl: publicOrigin(req),
    flow: body.data.flow,
  });
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
