// POST /api/studio-agent — Public. Body: { question }. Returns { filter, via }; the browser applies
// the deterministic filter to the rows it already has. Budgeted like every Claude-backed route.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { allow } from "@/lib/budget";
import { pickFilter } from "@/lib/studio-agent";

const Body = z.strictObject({ question: z.string().min(2).max(300) });

export async function POST(req: Request): Promise<Response> {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Ask a question about the queue." }, { status: 400 });
  const useClaude = Boolean(process.env["ANTHROPIC_API_KEY"]) && allow(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local").ok;
  return Response.json({ ok: true, ...(await pickFilter(body.data.question, useClaude ? new Anthropic() : null)) });
}
