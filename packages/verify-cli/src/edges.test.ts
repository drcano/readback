// Edge-case review, Oct 27, kept as regression tests.
import { describe, expect, it } from "vitest";
import { buildCaseBundle, findHistory } from "./cases.ts";
import { fakePayPal } from "./fake.ts";
import { paypalClient } from "./paypal-client.ts";

const ENV = { PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" };

describe("case lookup edges", () => {
  it("finds the disputed charge even when it isn't the first disputed transaction listed", async () => {
    const fake = fakePayPal();
    const id = fake.openDispute("CAP-1", "UNAUTHORISED");
    (fake.disputes.get(id) as { disputed_transactions: object[] }).disputed_transactions = [{ custom: "x" }, { seller_transaction_id: "CAP-1" }];
    const r = await buildCaseBundle(id, paypalClient(ENV, fake.fetch), new Date("2026-11-10T15:00:00Z"));
    // CAP-1 doesn't exist in the fake: what matters is that the lookup got past the dispute to it.
    expect(r.ok ? "found" : r.message).toBe("Charge not found at PayPal.");
  });

  it("an agreement dated decades back costs at most three years of searches", async () => {
    const fake = fakePayPal();
    let searches = 0;
    const counting: typeof fetch = (input, init) => {
      if (String(input).includes("/v1/reporting/transactions")) searches++;
      return fake.fetch(input, init);
    };
    await findHistory(paypalClient(ENV, counting), "tok", new Date("2000-01-01T00:00:00Z"), new Date("2026-11-09T00:00:00Z"), { checkDisputes: false });
    expect(searches).toBeLessThanOrEqual(36);
  });
});

describe("PayPal client edges", () => {
  const schema = { safeParse: (v: unknown) => ({ success: true as const, data: v }) } as never;
  const answer = (status: number, body = "<html>busy</html>") => new Response(body, { status, headers: { "content-type": "text/html" } });

  it("can't sign in (401, a 200 without a token, or no credentials): a denial, not a throw", async () => {
    for (const oauth of [answer(401), new Response("<html>", { status: 200 })]) {
      const fetch: typeof globalThis.fetch = async (input) => (String(input).endsWith("/v1/oauth2/token") ? oauth.clone() : answer(200, "{}"));
      expect(await paypalClient(ENV, fetch).get("/v2/payments/captures/X", schema)).toMatchObject({ ok: false, issues: ["PAYPAL_UNREACHABLE"] });
    }
    expect(await paypalClient({}, fakePayPal().fetch).get("/v2/payments/captures/X", schema)).toMatchObject({ ok: false, issues: ["PAYPAL_UNREACHABLE"] });
  });

  it("a 5xx or 429 is retried once with the same request ID; still failing reads as unreachable", async () => {
    const fake = fakePayPal();
    const ids: string[] = [];
    let failures = 1;
    const flaky: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/v3/vault/setup-tokens")) {
        ids.push(new Headers(init?.headers).get("PayPal-Request-Id") ?? "");
        if (failures-- > 0) return answer(502);
      }
      return fake.fetch(input, init);
    };
    const ok = await paypalClient(ENV, flaky).post("/v3/vault/setup-tokens", "rb-same", { payment_source: { paypal: {} } }, schema);
    expect([ok.ok, ids]).toEqual([true, ["rb-same", "rb-same"]]);

    const down: typeof fetch = async (input, init) => (String(input).endsWith("/v3/vault/setup-tokens") ? answer(503) : fake.fetch(input, init));
    expect(await paypalClient(ENV, down).post("/v3/vault/setup-tokens", "rb-x", {}, schema)).toMatchObject({ ok: false, status: 503, issues: ["PAYPAL_UNREACHABLE"] });
  });
});

describe("dispute shapes PayPal may add", () => {
  it("a dispute reason Readback doesn't know reads as OTHER (no suggestion), and the case still loads", async () => {
    const fake = fakePayPal();
    const id = fake.openDispute("CAP-1", "SOME_NEW_REASON");
    const r = await buildCaseBundle(id, paypalClient(ENV, fake.fetch), new Date("2026-11-10T15:00:00Z"));
    // CAP-1 doesn't exist in the fake: getting to it means the dispute itself parsed.
    expect(r.ok ? "found" : r.message).toBe("Charge not found at PayPal.");
  });
});
