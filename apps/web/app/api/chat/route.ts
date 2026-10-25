// POST /api/chat — Public (Claude + the agent runtime's judge path), budgeted (T34).
// Body: { messages: [{ role, content }] }, the visible conversation; nothing is kept between requests.
import Anthropic from "@anthropic-ai/sdk";
import { ChatBody, chat, mcpOverHttp } from "@/lib/agent-chat";
import { allow, clientIp } from "@/lib/budget";

export async function POST(req: Request): Promise<Response> {
  const body = ChatBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Send up to 12 short messages." }, { status: 400 });

  const runtime = process.env["AGENT_RUNTIME_URL"];
  const secret = process.env["JUDGE_MCP_SECRET"];
  const agreement = process.env["JUDGE_AGREEMENT_ID"];
  if (!runtime || !secret || !agreement || !process.env["ANTHROPIC_API_KEY"]) {
    return Response.json({ ok: false, message: "The demo agent isn't connected on this deployment. The rest of the demo still works." }, { status: 503 });
  }
  const budget = allow(clientIp(req));
  if (!budget.ok) return Response.json({ ok: false, message: budget.message }, { status: 429 });

  const client = new Anthropic();
  try {
    const reply = await chat(body.data.messages, {
      create: (params) => client.beta.messages.create(params),
      rpc: mcpOverHttp(`${runtime.replace(/\/$/, "")}/mcp/${secret}`),
      agreement,
      model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5-5",
    });
    return Response.json(reply, { status: reply.ok ? 200 : 502 });
  } catch (err) {
    if (!(err instanceof Anthropic.APIError)) throw err;
    console.warn(`agent-chat anthropic ${err.status ?? "?"}`);
    return Response.json({ ok: false, message: "The AI service didn't answer. Try again in a moment." }, { status: 502 });
  }
}
