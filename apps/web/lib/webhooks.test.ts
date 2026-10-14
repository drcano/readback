import { describe, expect, it } from "vitest";
import { paypalClient } from "./paypal/client";
import { verifyWebhook } from "./webhooks";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
const EVENT = JSON.stringify({ id: "WH-1", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: "PP-D-1" } });
const HEADERS = new Headers({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "t-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-11-08T15:00:00Z",
});

// A PayPal stand-in that answers verify-webhook-signature with the given status.
function paypalSays(status: string) {
  const calls: unknown[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "t" });
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ verification_status: status });
  }) as typeof fetch;
  return { client: paypalClient(ENV, f), calls };
}

describe("webhook verification", () => {
  it("accepts an event PayPal verifies, sending the exact fields PayPal expects", async () => {
    const { client, calls } = paypalSays("SUCCESS");
    const r = await verifyWebhook(client, HEADERS, EVENT, "WEBHOOK-ID");
    expect(r).toMatchObject({ ok: true, event: { event_type: "CUSTOMER.DISPUTE.CREATED" } });
    expect(calls[0]).toMatchObject({ transmission_id: "t-1", webhook_id: "WEBHOOK-ID", webhook_event: JSON.parse(EVENT) });
  });

  it("drops a spoofed event PayPal doesn't verify", async () => {
    expect(await verifyWebhook(paypalSays("FAILURE").client, HEADERS, EVENT, "WEBHOOK-ID")).toMatchObject({ ok: false });
  });

  it("drops events with missing headers, bad JSON, or no webhook ID configured, without calling PayPal", async () => {
    const { client, calls } = paypalSays("SUCCESS");
    const partial = new Headers(HEADERS);
    partial.delete("paypal-transmission-sig");
    expect(await verifyWebhook(client, partial, EVENT, "WEBHOOK-ID")).toMatchObject({ ok: false });
    expect(await verifyWebhook(client, HEADERS, "{nope", "WEBHOOK-ID")).toMatchObject({ ok: false });
    expect(await verifyWebhook(client, HEADERS, EVENT, undefined)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});
