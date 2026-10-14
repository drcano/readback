// An in-memory stand-in for the PayPal sandbox, for tests and evals only. It mimics the behaviours
// Readback relies on: vault tokens, orders that auto-complete on a saved wallet, the duplicate-
// invoice block, PayPal-Request-Id replay, and 404 for deleted tokens. Real behaviour is recorded
// by the spike (docs/decisions/0001-sandbox-spike.md); keep this in line with what it finds.
type Json = Record<string, unknown>;

export type FakePayPal = {
  fetch: typeof fetch;
  tokens: Map<string, Json>;
  orders: Map<string, Json>;
  posts: { path: string; requestId: string | null; body: unknown }[];
};

export function fakePayPal(): FakePayPal {
  const tokens = new Map<string, Json>();
  const orders = new Map<string, Json>();
  const byRequestId = new Map<string, Json>();
  const invoices = new Set<string>();
  const posts: FakePayPal["posts"] = [];
  let n = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "paypal-debug-id": `fake${++n}` } });

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const path = url.pathname;
    const headers = new Headers(init?.headers);
    if (path === "/v1/oauth2/token") return json(200, { access_token: "fake-token" });

    if (method === "POST") {
      const requestId = headers.get("PayPal-Request-Id");
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      posts.push({ path, requestId, body });
      if (requestId && byRequestId.has(`${path}|${requestId}`)) return json(200, byRequestId.get(`${path}|${requestId}`));
      const remember = (res: Json) => {
        if (requestId) byRequestId.set(`${path}|${requestId}`, res);
        return json(201, res);
      };

      if (path === "/v2/checkout/orders") {
        const req = body as { payment_source?: { paypal?: { vault_id?: string } }; purchase_units: Json[] };
        const pu = req.purchase_units[0] as { invoice_id?: string; amount: { value: string }; custom_id?: string };
        const vaultId = req.payment_source?.paypal?.vault_id;
        if (vaultId && !tokens.has(vaultId)) return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVALID_VAULT_ID" }] });
        if (pu.invoice_id && invoices.has(pu.invoice_id)) return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DUPLICATE_INVOICE_ID" }] });
        if (pu.invoice_id) invoices.add(pu.invoice_id);
        const id = `ORDER${++n}`;
        const order: Json = {
          id,
          status: "COMPLETED",
          payment_source: { paypal: { attributes: { vault: { id: vaultId } } } },
          purchase_units: [{ ...pu, payments: { captures: [{ id: `CAP${n}`, status: "COMPLETED", amount: { currency_code: "USD", value: pu.amount.value }, custom_id: pu.custom_id, invoice_id: pu.invoice_id }] } }],
        };
        orders.set(id, order);
        return remember(order);
      }
    }

    if (method === "GET" && path.startsWith("/v3/vault/payment-tokens/")) {
      const t = tokens.get(decodeURIComponent(path.split("/").pop()!));
      return t ? json(200, t) : json(404, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] });
    }
    if (method === "DELETE" && path.startsWith("/v3/vault/payment-tokens/")) {
      tokens.delete(decodeURIComponent(path.split("/").pop()!));
      return new Response(null, { status: 204 });
    }
    return json(404, { name: "RESOURCE_NOT_FOUND" });
  };

  return { fetch: fakeFetch as typeof fetch, tokens, orders, posts };
}
