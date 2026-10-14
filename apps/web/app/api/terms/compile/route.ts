// POST /api/terms/compile — Public (Claude only). Body: { instruction }. Returns draft terms and
// the deterministic readback card. Budgeted: capped input and output, per-IP limit, daily breaker (T34).
import { z } from "zod";
import { allow } from "@/lib/budget";
import { compileTerms } from "@/lib/terms-compiler";

const Body = z.strictObject({ instruction: z.string().min(3).max(500) });

export async function POST(req: Request): Promise<Response> {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Describe what your agent may buy (up to 500 characters)." }, { status: 400 });
  const gate = allow(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local");
  if (!gate.ok) return Response.json({ ok: false, message: gate.message }, { status: 429 });
  const result = await compileTerms(body.data.instruction, new Date().toISOString().slice(0, 10));
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
