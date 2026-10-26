// POST /api/webhooks/paypal — verified with PayPal first; unverified events are dropped (200, so
// PayPal doesn't retry a forgery). Logs event type and ID only, never the body.
import { allowWebhookVerify } from "@/lib/budget";
import { paypalClient } from "@/lib/paypal/client";
import { verifyWebhook } from "@/lib/webhooks";

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > 100_000) return new Response(null, { status: 413 });
  // Per-instance cap on verification calls; over it, events are dropped like unverified ones. Nothing
  // is lost: every screen re-reads PayPal, and a verified event only ever means "look again".
  if (!allowWebhookVerify("paypal").ok) {
    console.warn("webhook dropped: verification budget");
    return new Response(null, { status: 200 });
  }
  const v = await verifyWebhook(paypalClient(), req.headers, raw, process.env["PAYPAL_WEBHOOK_ID"]);
  if (!v.ok) {
    console.warn(`webhook dropped: ${v.reason}`);
    return new Response(null, { status: 200 });
  }
  console.info(`webhook ${v.event.event_type} ${v.event.id}`);
  return new Response(null, { status: 200 });
}
