// POST /api/cases/[id]/actions — Admin (MERCHANT_ADMIN_TOKEN). Sends a merchant action Sam approved,
// following the dispute's own links (SPEC §5.5, §5.10). View-only on the public deployment.
import { ActionRequestSchema, runDisputeAction } from "@/lib/actions";
import { isAdmin } from "@/lib/admin";
import { paypalClient } from "@/lib/paypal/client";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isAdmin(req)) return Response.json({ ok: false, message: "Sending is for the store's admin only." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^PP-[DR]-[A-Za-z0-9-]{1,60}$/.test(id)) return Response.json({ ok: false, message: "Not a dispute ID." }, { status: 400 });
  const body = ActionRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Choose an action and include the approved text." }, { status: 400 });
  const r = await runDisputeAction(paypalClient(), id, body.data);
  return Response.json(r, { status: r.ok ? 200 : r.status });
}
