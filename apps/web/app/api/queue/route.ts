// GET /api/queue — Public. Live disputes (evaluated from PayPal) plus labeled fixtures.
import { buildQueue } from "@/lib/queue";
import { paypalClient } from "@/lib/paypal/client";

export async function GET(): Promise<Response> {
  const configured = Boolean(process.env["PAYPAL_CLIENT_ID"] && process.env["PAYPAL_CLIENT_SECRET"]);
  return Response.json(await buildQueue(configured ? paypalClient() : null, new Date()));
}
