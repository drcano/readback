// POST /api/cases/[id]/brief — Public (Claude only), budgeted. The case is re-fetched and re-checked
// server-side; a bundle sent by the client is never trusted. Returns a cited, validated brief.
import Anthropic from "@anthropic-ai/sdk";
import { evaluateCase } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";
import { allow, clientIp } from "@/lib/budget";
import { writeBrief } from "@/lib/brief";
import { buildCaseBundle } from "@/lib/cases";
import { paypalClient } from "@/lib/paypal/client";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
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
  const result = await evaluateCase(bundle);
  const useClaude = Boolean(process.env["ANTHROPIC_API_KEY"]) && allow(clientIp(req)).ok;
  return Response.json({ ok: true, brief: await writeBrief(bundle, result, useClaude ? new Anthropic() : null) });
}
