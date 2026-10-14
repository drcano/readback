// POST /api/demo/direct-charge — Demo only (DEMO_MODE=true against the sandbox), proof from the
// judge tab's key. Body: { tokenId, proof }. Returns the capture ID for preview mode.
import { TokenIdSchema } from "@readback/core";
import { z } from "zod";
import { allowDirectCharge, clientIp } from "@/lib/budget";
import { demoEnabled, directCharge } from "@/lib/demo";
import { paypalClient } from "@/lib/paypal/client";

const Body = z.strictObject({ tokenId: TokenIdSchema, proof: z.string().max(2048) });

export async function POST(req: Request): Promise<Response> {
  if (!demoEnabled(process.env)) return new Response("Not found", { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, failure: { code: "BAD_REQUEST", message: "Send { tokenId, proof }." } }, { status: 400 });
  const gate = allowDirectCharge(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, failure: { code: "RATE_LIMITED", message: gate.message } }, { status: 429 });
  const result = await directCharge(paypalClient(), body.data, new Date());
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
