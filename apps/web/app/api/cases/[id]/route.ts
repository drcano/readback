// GET /api/cases/[id] — Public. A dispute ID (PP-D-…) or a capture ID (preview mode).
// Returns the case bundle (only the fields the checks read) plus the server-side result; the
// browser re-runs the same checks from the bundle with readback-core (SPEC §5.6 "Re-verify").
import { evaluateCase } from "@readback/core";
import { buildCaseBundle } from "@/lib/cases";
import { paypalClient } from "@/lib/paypal/client";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return Response.json({ ok: false, message: "Not a dispute or charge ID." }, { status: 400 });
  const lookup = await buildCaseBundle(id, paypalClient(), new Date());
  if (!lookup.ok) return Response.json(lookup, { status: lookup.status });
  const result = await evaluateCase(lookup.bundle);
  return Response.json({ ok: true, bundle: lookup.bundle, result });
}
