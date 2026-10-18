// Typed PayPal REST client for the merchant app (server-only).
// - One client per request: the OAuth token lives only as long as the request (stores nothing).
// - Every POST carries a deterministic PayPal-Request-Id chosen by the caller.
// - Responses are parsed with zod at this boundary; inside the app, types can be trusted.
// - Logs only method, path, status and PayPal's debug_id: never bodies, tokens or personal data.
import type { z } from "zod";

export type PayPalOk<T> = { ok: true; status: number; data: T; debugId: string | null };
export type PayPalErr = { ok: false; status: number; issues: string[]; debugId: string | null };
export type PayPalResult<T> = PayPalOk<T> | PayPalErr;

type Env = Record<string, string | undefined>;

export function paypalClient(env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  const base = env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";
  // ponytail: a fresh OAuth token per request keeps "stores nothing" literal; cache it per
  // instance if PayPal rate limits or latency ever matter (the token holds no customer data).
  let token: string | undefined;

  async function accessToken(): Promise<string> {
    if (token) return token;
    const id = env["PAYPAL_CLIENT_ID"];
    const secret = env["PAYPAL_CLIENT_SECRET"];
    if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} (debug_id ${res.headers.get("paypal-debug-id")})`);
    token = ((await res.json()) as { access_token: string }).access_token;
    return token;
  }

  async function call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    schema: z.ZodType<T>,
    opts: { requestId?: string; body?: unknown; form?: FormData } = {},
  ): Promise<PayPalResult<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
    if (method === "POST") {
      if (!opts.requestId) throw new Error(`POST ${path} needs a PayPal-Request-Id`);
      headers["PayPal-Request-Id"] = opts.requestId;
      // A multipart body gets no Content-Type here: fetch adds it with the boundary.
      if (!opts.form) headers["Content-Type"] = "application/json";
      headers["Prefer"] = "return=representation";
    }
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const debugId = res.headers.get("paypal-debug-id");
    console.info(`paypal ${method} ${path.split("?")[0]} ${res.status} ${debugId ?? ""}`);
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const details = (json as { details?: { issue?: string }[]; name?: string }).details;
      const issues = details?.map((d) => d.issue ?? "UNKNOWN") ?? [(json as { name?: string }).name ?? `HTTP_${res.status}`];
      return { ok: false, status: res.status, issues, debugId };
    }
    const parsed = schema.safeParse(json);
    // An unexpected shape is a failure like any other: callers deny (fail closed), nothing throws.
    if (!parsed.success) {
      console.warn(`paypal ${method} ${path.split("?")[0]} unexpected response shape ${debugId ?? ""}`);
      return { ok: false, status: 502, issues: ["UNEXPECTED_RESPONSE_SHAPE"], debugId };
    }
    return { ok: true, status: res.status, data: parsed.data, debugId };
  }

  return {
    get: <T>(path: string, schema: z.ZodType<T>) => call("GET", path, schema),
    post: <T>(path: string, requestId: string, body: unknown, schema: z.ZodType<T>) => call("POST", path, schema, { requestId, body }),
    // Disputes' evidence and supporting-info endpoints take multipart (spike step 7).
    postForm: <T>(path: string, requestId: string, form: FormData, schema: z.ZodType<T>) => call("POST", path, schema, { requestId, form }),
    delete: <T>(path: string, schema: z.ZodType<T>) => call("DELETE", path, schema),
  };
}

export type PayPalClient = ReturnType<typeof paypalClient>;
