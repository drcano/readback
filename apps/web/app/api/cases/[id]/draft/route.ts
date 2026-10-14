// POST /api/cases/[id]/draft — Public (draft only; sending is a separate Admin action). The case is
// re-fetched and re-checked server-side; the draft is generated from those facts.
import { evaluateCase } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";
import { buildCaseBundle } from "@/lib/cases";
import { draftMessage } from "@/lib/inquiry";
import { paypalClient } from "@/lib/paypal/client";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return Response.json({ ok: false }, { status: 400 });
  let bundle;
  if (id.startsWith("fixture-")) {
    const wanted = { "fixture-hero": "PP-D-HERO1", "fixture-twist": "PP-D-TWIST" }[id] ?? id.slice("fixture-".length);
    bundle = (await fixtureCases()).find((f) => f.id === wanted)?.bundle;
  } else {
    const lookup = await buildCaseBundle(id, paypalClient(), new Date());
    if (lookup.ok) bundle = lookup.bundle;
  }
  if (!bundle) return Response.json({ ok: false, message: "Case not found." }, { status: 404 });
  return Response.json({ ok: true, draft: draftMessage(bundle, await evaluateCase(bundle)) });
}
