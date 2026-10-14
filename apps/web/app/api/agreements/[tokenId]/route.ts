// GET /api/agreements/[tokenId] — Public: terms, status, recent charges, live from PayPal; no personal data.
// DELETE — a proof from the agreement's agent key ({ proof } body, SPEC §4.7) or MERCHANT_ADMIN_TOKEN.
import { TokenIdSchema } from "@readback/core";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { readAgreement, revokeAgreement } from "@/lib/agreements";
import { paypalClient } from "@/lib/paypal/client";

type Ctx = { params: Promise<{ tokenId: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const id = TokenIdSchema.safeParse((await ctx.params).tokenId);
  if (!id.success) return Response.json({ ok: false }, { status: 400 });
  const view = await readAgreement(paypalClient(), id.data, new Date());
  return view ? Response.json({ ok: true, ...view }) : Response.json({ ok: false }, { status: 502 });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const id = TokenIdSchema.safeParse((await ctx.params).tokenId);
  if (!id.success) return Response.json({ ok: false }, { status: 400 });
  const body = z.object({ proof: z.string().max(2048).optional() }).safeParse(await req.json().catch(() => ({})));
  const result = await revokeAgreement(paypalClient(), id.data, { proof: body.success ? body.data.proof : undefined, adminOk: isAdmin(req) }, Math.floor(Date.now() / 1000));
  return result.ok ? new Response(null, { status: 204 }) : Response.json(result, { status: result.status });
}
