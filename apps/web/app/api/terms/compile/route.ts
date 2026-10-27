// POST /api/terms/compile — Public (Claude only). Body: { instruction }. Returns draft terms and
// the deterministic readback card. Budgeted: capped input and output, per-IP limit, daily breaker (T34).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { allow, clientIp } from "@/lib/budget";
import { compileTerms } from "@/lib/terms-compiler";

const Body = z.strictObject({ instruction: z.string().min(3).max(500) });

export async function POST(req: Request): Promise<Response> {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Describe what your agent may buy (up to 500 characters)." }, { status: 400 });
  // The same designed states as the chat: no key on this deployment, or Claude not answering.
  if (!process.env["ANTHROPIC_API_KEY"]) {
    return Response.json({ ok: false, message: "The AI drafting isn't connected on this deployment. Try judge mode on the home page." }, { status: 503 });
  }
  const gate = allow(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, message: gate.message }, { status: 429 });
  try {
    const result = await compileTerms(body.data.instruction, new Date().toISOString().slice(0, 10));
    return Response.json(result, { status: result.ok ? 200 : result.status });
  } catch (err) {
    if (!(err instanceof Anthropic.APIError)) throw err;
    console.warn(`terms compile: Claude ${err.status ?? "error"}`);
    return Response.json({ ok: false, message: "The AI service didn't answer. Try again in a moment." }, { status: 502 });
  }
}
