// GET /api/queue — Public. Live disputes (evaluated from PayPal) plus labeled fixtures.
import { allowQueue, clientIp } from "@/lib/budget";
import { buildQueue } from "@/lib/queue";
import { paypalClient } from "@/lib/paypal/client";

export async function GET(req: Request): Promise<Response> {
  const configured = Boolean(process.env["PAYPAL_CLIENT_ID"] && process.env["PAYPAL_CLIENT_SECRET"]);
  const budget = allowQueue(clientIp(req));
  // Over the limit: the labeled examples still load; PayPal isn't called.
  if (!budget.ok) return Response.json({ ...(await buildQueue(null, new Date())), liveError: budget.message }, { status: 429 });
  return Response.json(await buildQueue(configured ? paypalClient() : null, new Date()));
}
