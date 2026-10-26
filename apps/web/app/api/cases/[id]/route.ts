// GET /api/cases/[id] — Public. A dispute ID (PP-D-… or PP-R-…) or a capture ID (preview mode).
// Returns the case bundle (only the fields the checks read) plus the server-side result; the
// browser re-runs the same checks from the bundle with readback-core (SPEC §5.6 "Re-verify").
// ?stream=1 streams the same build as NDJSON, one line per PayPal record as it's read (lib/case-stream).
import { evaluateCase } from "@readback/core";
import { allowLookup, clientIp } from "@/lib/budget";
import { buildCaseBundle } from "@/lib/cases";
import { streamCase } from "@/lib/case-stream";
import { paypalClient } from "@/lib/paypal/client";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return Response.json({ ok: false, message: "Not a dispute or charge ID." }, { status: 400 });
  const budget = allowLookup(clientIp(req));
  if (!budget.ok) return Response.json({ ok: false, message: budget.message }, { status: 429 });
  if (new URL(req.url).searchParams.get("stream") === "1") {
    // no-transform: Next's gzip would otherwise hold the small lines back until the end.
    return new Response(streamCase(id, new Date()), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" } });
  }
  const lookup = await buildCaseBundle(id, paypalClient(), new Date());
  if (!lookup.ok) return Response.json(lookup, { status: lookup.status });
  const result = await evaluateCase(lookup.bundle);
  return Response.json({ ok: true, bundle: lookup.bundle, result });
}
