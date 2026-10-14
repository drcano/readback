// Minimal PayPal REST helper for the sandbox spike.
// Throwaway on purpose: product code uses @paypal/paypal-server-sdk + apps/web/lib/paypal.
const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
if (!BASE.includes("sandbox")) throw new Error(`Spike scripts run against the sandbox only, not ${BASE}`);

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

export type PayPalRequest =
  | { method: "GET"; path: string }
  // Every POST names its PayPal-Request-Id. It's derived from the operation, never random,
  // so retrying the same operation is a no-op on PayPal's side (CLAUDE.md §5).
  | { method: "POST"; path: string; requestId: string; body: unknown };

// Calls PayPal and returns the parsed JSON. Throws with PayPal's error body and debug_id on failure.
export async function paypal(req: PayPalRequest): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken()}`,
    "Content-Type": "application/json",
  };
  if (req.method === "POST") {
    headers["PayPal-Request-Id"] = req.requestId;
    headers["Prefer"] = "return=representation"; // full object back, not just links
  }

  const res = await fetch(`${BASE}${req.path}`, {
    method: req.method,
    headers,
    body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};
  console.log(`${req.method} ${req.path} -> ${res.status} (debug_id ${res.headers.get("paypal-debug-id")})`);
  if (!res.ok) throw new Error(JSON.stringify(json, null, 2));
  return json;
}
