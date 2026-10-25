// POST /api/chat — Public, budgeted (T34). Body: { agreement, messages }: the judge's own agreement ID
// and the visible conversation. Reads the agreement from PayPal; never signs anything (the judge's
// tab does, SPEC §5.7). Nothing is kept between requests.
import Anthropic from "@anthropic-ai/sdk";
import { ChatBody, chat } from "@/lib/agent-chat";
import { readAgreement } from "@/lib/agreements";
import { allow, clientIp } from "@/lib/budget";
import { paypalClient } from "@/lib/paypal/client";

export async function POST(req: Request): Promise<Response> {
  const body = ChatBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, message: "Send your agreement and up to 16 short messages." }, { status: 400 });
  if (!process.env["ANTHROPIC_API_KEY"]) {
    return Response.json({ ok: false, message: "The AI assistant isn't connected on this deployment. Use the one-click buy instead." }, { status: 503 });
  }
  const budget = allow(clientIp(req));
  if (!budget.ok) return Response.json({ ok: false, message: budget.message }, { status: 429 });

  const client = new Anthropic();
  try {
    const reply = await chat(body.data, {
      create: (params) => client.beta.messages.create(params),
      agreement: () => readAgreement(paypalClient(), body.data.agreement, new Date()),
      model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5-5",
    });
    return Response.json(reply, { status: reply.ok ? 200 : 400 });
  } catch (err) {
    if (!(err instanceof Anthropic.APIError)) throw err;
    console.warn(`chat anthropic ${err.status ?? "?"}`);
    return Response.json({ ok: false, message: "The AI service didn't answer. Try again in a moment." }, { status: 502 });
  }
}
