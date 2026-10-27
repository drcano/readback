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
