// POST /api/checkout — Public; the signed mandate is the credential (SPEC §5.10).
// Body: { "mandate": "<compact JWS>" }. Returns the capture and order IDs, or plain-language denials.
import { z } from "zod";
import { checkout } from "@/lib/checkout";
import { paypalClient } from "@/lib/paypal/client";

const Body = z.strictObject({ mandate: z.string().max(2048) });

export async function POST(req: Request): Promise<Response> {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ ok: false, failures: [{ code: "BAD_REQUEST", message: "Send { mandate: <signed request> }." }] }, { status: 400 });
  }
  const result = await checkout(body.data.mandate, paypalClient(), Math.floor(Date.now() / 1000));
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
