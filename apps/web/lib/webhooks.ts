// PayPal webhooks: verified with PayPal's verify-webhook-signature endpoint before anything else.
// Unverified events are logged (type only) and dropped. Readback stores nothing, so a verified
// event only says "look again": every screen re-fetches from PayPal anyway (SPEC §5.5).
import { sha256Hex } from "@readback/core";
import { z } from "zod";
import type { PayPalClient } from "./paypal/client";

const HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

const EventSchema = z.object({ id: z.string(), event_type: z.string(), resource: z.unknown().optional() });
export type WebhookEvent = z.infer<typeof EventSchema>;

export async function verifyWebhook(
  paypal: PayPalClient,
  headers: Headers,
  rawBody: string,
  webhookId: string | undefined,
): Promise<{ ok: true; event: WebhookEvent } | { ok: false; reason: string }> {
  if (!webhookId) return { ok: false, reason: "PAYPAL_WEBHOOK_ID not set" };
  const fields = Object.fromEntries(Object.entries(HEADERS).map(([k, h]) => [k, headers.get(h)]));
  if (Object.values(fields).some((v) => !v)) return { ok: false, reason: "missing PayPal transmission headers" };
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }
  const parsed = EventSchema.safeParse(event);
  if (!parsed.success) return { ok: false, reason: "not a webhook event" };
  // Deterministic per delivery, so a retried verification is a no-op.
  const requestId = `rb-whv-${(await sha256Hex(`${fields["transmission_id"]}:${parsed.data.id}`)).slice(0, 40)}`;
  const res = await paypal.post(
    "/v1/notifications/verify-webhook-signature",
    requestId,
    { ...fields, webhook_id: webhookId, webhook_event: event },
    z.object({ verification_status: z.string() }),
  );
  if (!res.ok || res.data.verification_status !== "SUCCESS") return { ok: false, reason: "signature not verified by PayPal" };
  return { ok: true, event: parsed.data };
}
