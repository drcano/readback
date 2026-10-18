import { describe, expect, it } from "vitest";
import { runDisputeAction } from "./actions";
import { paypalClient } from "./paypal/client";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };

// A PayPal stand-in serving one dispute (links as recorded in spike step 7) and logging POSTs.
function paypalWith(dispute: Record<string, unknown>) {
  const posts: { url: string; headers: Headers; body: unknown }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "t" });
    if (init?.method === "GET") return Response.json(dispute);
    posts.push({ url, headers: new Headers(init?.headers), body: init?.body });
    return Response.json({ links: [] });
  }) as typeof fetch;
  return { client: paypalClient(ENV, f), posts };
}

const UNDER_PAYPAL_REVIEW = {
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  links: [{ rel: "self", href: "x" }, { rel: "provide_supporting_info", href: "x" }],
  evidences: [{ notes: "buyer's note" }],
};

describe("dispute actions", () => {
  it("sends supporting info as multipart with an input part and a deterministic request ID", async () => {
    const { client, posts } = paypalWith(UNDER_PAYPAL_REVIEW);
    const req = { action: "provide_supporting_info", text: "Signed by her agent." } as const;
    expect(await runDisputeAction(client, "PP-R-1", req)).toMatchObject({ ok: true, sent: true });
    await runDisputeAction(client, "PP-R-1", req);
    expect(posts[0]!.url).toMatch(/\/PP-R-1\/provide-supporting-info$/);
    expect(posts[0]!.headers.get("content-type")).toBeNull(); // fetch sets the multipart boundary
    expect(JSON.parse(await ((posts[0]!.body as FormData).get("input") as Blob).text())).toEqual({ notes: "Signed by her agent." });
    expect(posts[1]!.headers.get("paypal-request-id")).toBe(posts[0]!.headers.get("paypal-request-id"));
  });

  it("refuses an action the dispute's links don't offer, naming what PayPal does offer", async () => {
    const { client, posts } = paypalWith(UNDER_PAYPAL_REVIEW);
    const r = await runDisputeAction(client, "PP-R-1", { action: "provide_evidence", text: "x" });
    expect(r).toEqual({ ok: false, status: 409, message: expect.stringContaining("provide_supporting_info") });
    expect(posts).toHaveLength(0);
  });

  it("doesn't resend text already on the case", async () => {
    const { client, posts } = paypalWith(UNDER_PAYPAL_REVIEW);
    expect(await runDisputeAction(client, "PP-R-1", { action: "provide_supporting_info", text: "buyer's note" })).toMatchObject({ ok: true, sent: false });
    expect(posts).toHaveLength(0);
  });
});
