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
  | { method: "GET" | "DELETE"; path: string }
  // Every POST names its PayPal-Request-Id. It's derived from the operation, never random,
  // so retrying the same operation is a no-op on PayPal's side (CLAUDE.md §5).
  // `headers` is for sandbox-only extras such as PayPal-Mock-Response (negative testing).
  | { method: "POST"; path: string; requestId: string; body: unknown; headers?: Record<string, string> }
  // Multipart POST (Disputes provide-evidence). fetch writes the Content-Type + boundary itself.
  | { method: "POST"; path: string; requestId: string; form: FormData };

// What came back, success or not. Like Python's `requests.Response` but already parsed.
export type PayPalResponse = { status: number; ok: boolean; json: unknown; debugId: string | null };

// Calls PayPal and never throws on an HTTP error: the spike needs to inspect failures
// (DUPLICATE_INVOICE_ID, INVALID_VAULT_ID, 404) as data, not parse them out of exception text.
export async function paypalRaw(req: PayPalRequest): Promise<PayPalResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await getAccessToken()}` };
  let body: string | FormData | undefined;
  if (req.method === "POST") {
    // Inside this branch TypeScript knows req is one of the two POST shapes ("narrowing").
    headers["PayPal-Request-Id"] = req.requestId;
    headers["Prefer"] = "return=representation"; // full object back, not just links
    if ("form" in req) {
      body = req.form; // no Content-Type: fetch must add the multipart boundary itself
    } else {
      headers["Content-Type"] = "application/json";
      Object.assign(headers, req.headers);
      body = JSON.stringify(req.body);
    }
  }

  // Time out at 25 s and retry once with the same PayPal-Request-Id (PayPal replays it). Without
  // this, the seed job waited out undici's 300 s default on Oct 23 and 25 and lost both charges' fixtures.
  const send = () => fetch(`${BASE}${req.path}`, { method: req.method, headers, body, signal: AbortSignal.timeout(25_000) });
  const res = await send().catch(send);
  const text = await res.text();
  let json: unknown = {};
  try {
    if (text) json = JSON.parse(text);
  } catch {
    json = { non_json_body: text.slice(0, 500) }; // keep it visible instead of crashing
  }
  const debugId = res.headers.get("paypal-debug-id");
  console.log(`${req.method} ${req.path} -> ${res.status} (debug_id ${debugId})`);
  return { status: res.status, ok: res.ok, json, debugId };
}

// Calls PayPal and returns the parsed JSON. Throws with PayPal's error body and debug_id on failure.
export async function paypal(req: PayPalRequest): Promise<unknown> {
  const res = await paypalRaw(req);
  if (!res.ok) throw new Error(`${res.status} debug_id ${res.debugId}\n${JSON.stringify(res.json, null, 2)}`);
  return res.json;
}

// PayPal error bodies list problems as details[].issue (e.g. "DUPLICATE_INVOICE_ID").
export function issues(json: unknown): string[] {
  const details = (json as { details?: { issue?: string }[] }).details ?? [];
  return details.map((d) => d.issue ?? "?");
}
