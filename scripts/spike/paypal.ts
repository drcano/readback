// Minimal PayPal REST helper for the day-one sandbox spike.
// Throwaway on purpose: product code uses @paypal/paypal-server-sdk + apps/web/lib/paypal.
import { randomUUID } from "node:crypto";

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

let cachedToken: string | undefined;

// OAuth2 client-credentials: trade client ID + secret for a short-lived access token.
export async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const basic = Buffer.from(
    `${requireEnv("PAYPAL_CLIENT_ID")}:${requireEnv("PAYPAL_CLIENT_SECRET")}`,
  ).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  cachedToken = data.access_token; // never log this
  return cachedToken;
}

// Calls a PayPal endpoint. Every POST gets a fresh PayPal-Request-Id (idempotency key).
export async function paypal(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken()}`,
    "Content-Type": "application/json",
  };
  if (method === "POST") headers["PayPal-Request-Id"] = randomUUID();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};
  console.log(`${method} ${path} -> ${res.status} (debug_id ${res.headers.get("paypal-debug-id")})`);
  if (!res.ok) throw new Error(JSON.stringify(json, null, 2));
  return json;
}
