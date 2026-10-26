// An in-memory stand-in for the PayPal sandbox, for tests and evals only. It mimics the behaviours
// Readback relies on: vault tokens, orders that auto-complete on a saved wallet, the duplicate-
// invoice block, PayPal-Request-Id replay, and 404 for deleted tokens. Real behaviour is recorded
// by the spike (docs/decisions/0001-sandbox-spike.md); keep this in line with what it finds.
type Json = Record<string, unknown>;

export type FakePayPal = {
  fetch: typeof fetch;
  tokens: Map<string, Json>;
  orders: Map<string, Json>;
  disputes: Map<string, Json>;
  posts: { path: string; requestId: string | null; body: unknown }[];
  clock: { now: string }; // capture create_time = this, so tests control history dates
  approve: (setupTokenId: string) => void; // stands in for Maya clicking Agree on PayPal
  openDispute: (captureId: string, reason: string) => string;
};

export function fakePayPal(): FakePayPal {
  const tokens = new Map<string, Json>();
  const orders = new Map<string, Json>();
  const byRequestId = new Map<string, Json>();
  const invoices = new Set<string>();
  const disputes = new Map<string, Json>();
  const setupTokens = new Map<string, Json>();
  const approved = new Set<string>();
  const posts: FakePayPal["posts"] = [];
  const clock = { now: new Date().toISOString() };
  const captureToOrder = new Map<string, string>();
  let n = 0;

  const captureById = (capId: string) => {
    const order = orders.get(captureToOrder.get(capId) ?? "");
    const pu = (order?.["purchase_units"] as { payments: { captures: Json[] } }[] | undefined)?.[0];
    return pu?.payments.captures.find((c) => c["id"] === capId);
  };

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
      // Disputes' supporting info is multipart with an `input` JSON part (spike step 7).
      const form = init?.body instanceof FormData ? init.body : null;
      const body: unknown = form ? JSON.parse(await (form.get("input") as Blob).text()) : init?.body ? JSON.parse(String(init.body)) : undefined;
      posts.push({ path, requestId, body });
      if (requestId && byRequestId.has(`${path}|${requestId}`)) return json(200, byRequestId.get(`${path}|${requestId}`));
      const info = /^\/v1\/customer\/disputes\/([^/]+)\/provide-supporting-info$/.exec(path);
      if (info) {
        const d = disputes.get(info[1]!);
        if (!d) return json(404, { name: "RESOURCE_NOT_FOUND" });
        d["supporting_info"] = [...((d["supporting_info"] as Json[] | undefined) ?? []), { notes: (body as { notes: string }).notes, source: "SUBMITTED_BY_SELLER", provided_time: clock.now }];
        if (requestId) byRequestId.set(`${path}|${requestId}`, { links: [] });
        return json(200, { links: [] });
      }
      const remember = (res: Json) => {
        if (requestId) byRequestId.set(`${path}|${requestId}`, res);
        return json(201, res);
      };

      if (path === "/v3/vault/setup-tokens") {
        const id = `SETUP${++n}`;
        setupTokens.set(id, body as Json);
        return remember({ id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/agreements/approve?approval_session_id=${id}` }] });
      }
      if (path === "/v3/vault/payment-tokens") {
        const setupId = (body as { payment_source: { token: { id: string } } }).payment_source.token.id;
        const setup = setupTokens.get(setupId) as { payment_source: { paypal: { description: string } } } | undefined;
        if (!setup || !approved.has(setupId)) return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "SETUP_TOKEN_NOT_APPROVED" }] });
        const id = `tok${++n}`;
        // billing_plan is display-only: PayPal doesn't return it (SPEC §3).
        tokens.set(id, { id, payment_source: { paypal: { description: setup.payment_source.paypal.description, payer_id: "MAYA00000001" } } });
        return remember(tokens.get(id)!);
      }
      const track = /^\/v2\/checkout\/orders\/([^/]+)\/track$/.exec(path);
      if (track) {
        const order = orders.get(track[1]!);
        if (!order) return json(404, { name: "RESOURCE_NOT_FOUND" });
        const pu = (order["purchase_units"] as Json[])[0]!;
        const shipping = (pu["shipping"] ?? {}) as { trackers?: Json[] };
        shipping.trackers = [...(shipping.trackers ?? []), { id: `TRK${++n}`, status: "SHIPPED" }];
        pu["shipping"] = shipping;
        return remember(order);
      }
      if (path === "/v2/checkout/orders") {
        const req = body as { payment_source?: { paypal?: { vault_id?: string } }; purchase_units: Json[] };
        const pu = req.purchase_units[0] as { invoice_id?: string; amount: { value: string }; custom_id?: string };
        const vaultId = req.payment_source?.paypal?.vault_id;
        if (vaultId && !tokens.has(vaultId)) return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVALID_VAULT_ID" }] });
        if (pu.invoice_id && invoices.has(pu.invoice_id)) return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DUPLICATE_INVOICE_ID" }] });
        if (pu.invoice_id) invoices.add(pu.invoice_id);
        const id = `ORDER${++n}`;
        const payerId = (tokens.get(vaultId ?? "")?.["payment_source"] as { paypal?: { payer_id?: string } } | undefined)?.paypal?.payer_id;
        const capture = { id: `CAP${n}`, status: "COMPLETED", create_time: clock.now, amount: { currency_code: "USD", value: pu.amount.value }, custom_id: pu.custom_id, invoice_id: pu.invoice_id, seller_protection: { status: "ELIGIBLE" } };
        const order: Json = {
          id,
          status: "COMPLETED",
          payer: { payer_id: payerId },
          // No vault echo: the sandbox doesn't return one (spike step 3).
          payment_source: { paypal: {} },
          purchase_units: [{ ...pu, payments: { captures: [capture] } }],
        };
        orders.set(id, order);
        captureToOrder.set(capture.id, id);
        return remember(order);
      }
    }

    if (method === "GET" && path.startsWith("/v2/checkout/orders/")) {
      const o = orders.get(path.split("/").pop()!);
      return o ? json(200, o) : json(404, { name: "RESOURCE_NOT_FOUND" });
    }
    if (method === "GET" && path.startsWith("/v2/payments/captures/")) {
      const capId = path.split("/").pop()!;
      const c = captureById(capId);
      return c ? json(200, { ...c, supplementary_data: { related_ids: { order_id: captureToOrder.get(capId) } } }) : json(404, { name: "RESOURCE_NOT_FOUND" });
    }
    if (method === "GET" && path === "/v1/reporting/transactions") {
      const [from, to] = [Date.parse(url.searchParams.get("start_date")!), Date.parse(url.searchParams.get("end_date")!)];
      const details = [...captureToOrder.keys()]
        .map((capId) => captureById(capId)!)
        .filter((c) => Date.parse(String(c["create_time"])) >= from && Date.parse(String(c["create_time"])) <= to)
        .map((c) => ({ transaction_info: { transaction_id: c["id"], transaction_initiation_date: c["create_time"], custom_field: c["custom_id"], transaction_event_code: "T0003", transaction_status: "S" } }));
      return json(200, { transaction_details: details, total_pages: 1 });
    }
    if (method === "GET" && path === "/v1/customer/disputes") {
      const txn = url.searchParams.get("disputed_transaction_id");
      const items = [...disputes.values()].filter((d) => (d["disputed_transactions"] as { seller_transaction_id: string }[])[0]?.seller_transaction_id === txn);
      return json(200, { items: items.map((d) => ({ dispute_id: d["dispute_id"] })) });
    }
    if (method === "GET" && path.startsWith("/v1/customer/disputes/")) {
      const d = disputes.get(path.split("/").pop()!);
      return d ? json(200, d) : json(404, { name: "RESOURCE_NOT_FOUND" });
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

  const openDispute = (captureId: string, reason: string): string => {
    const id = `PP-D-${++n}`;
    const c = captureById(captureId);
    disputes.set(id, {
      dispute_id: id, reason, status: "UNDER_REVIEW", dispute_life_cycle_stage: "CHARGEBACK",
      // In this state the sandbox offered only supporting info (spike step 7).
      links: [{ rel: "self", href: `/v1/customer/disputes/${id}` }, { rel: "provide_supporting_info", href: `/v1/customer/disputes/${id}/provide-supporting-info` }],
      disputed_transactions: [{ seller_transaction_id: captureId, custom: c?.["custom_id"], invoice_number: c?.["invoice_id"] }],
    });
    return id;
  };

  return { fetch: fakeFetch as typeof fetch, tokens, orders, disputes, posts, clock, openDispute, approve: (id) => approved.add(id) };
}
