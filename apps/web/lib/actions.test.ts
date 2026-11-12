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

describe("send Readback's evidence (end to end over the PayPal fake)", () => {
  it("rebuilds the case from PayPal, sends the statement as supporting info, and finds it on the dispute", async () => {
    const { fakePayPal } = await import("./paypal/fake");
    const { formatTerms, generateAgentKey, buildMandate, sha256Hex, signMandate } = await import("@readbackhq/core");
    const { checkout } = await import("./checkout");
    const pp = fakePayPal();
    const key = await generateAgentKey(true);
    const terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: key.fingerprint };
    pp.tokens.set("tok1", { id: "tok1", payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA1" } } });
    const iat = Date.parse("2026-11-08T15:00:00Z") / 1000;
    pp.clock.now = "2026-11-08T15:00:05Z";
    const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: "tok1", terms, termsHash: await sha256Hex(formatTerms(terms)) }, iat, "jti-evidence1");
    if (!m.ok) throw new Error(m.error.code);
    const charged = await checkout(await signMandate(m.value, key.privateKey, key.publicJwk), paypalClient(ENV, pp.fetch), iat + 5);
    if (!charged.ok) throw new Error("charge");
    const disputeId = pp.openDispute(charged.captureId, "UNAUTHORISED");

    const client = paypalClient(ENV, pp.fetch);
    const r = await runDisputeAction(client, disputeId, { action: "send_evidence" }, new Date("2026-11-09T12:00:00Z"));
    expect(r).toMatchObject({ ok: true, sent: true, via: "provide_supporting_info", onPayPalRecord: true });
    const notes = (pp.disputes.get(disputeId)!["supporting_info"] as { notes: string }[])[0]!.notes;
    expect(notes).toContain(`Readback evidence for dispute ${disputeId}`);
    expect(notes).toContain(charged.captureId);
    expect(notes).toContain("2. Agent: PASS");
    // Sending again is a no-op: the same statement is already on PayPal's record.
    expect(await runDisputeAction(client, disputeId, { action: "send_evidence" }, new Date("2026-11-09T12:00:00Z"))).toMatchObject({ ok: true, sent: false });
  });
});

describe("refund the buyer when the evidence supports them (end to end over the PayPal fake)", () => {
  it("accepts the claim with a full refund, explains why in a note written by code, and only once", async () => {
    const { fakePayPal } = await import("./paypal/fake");
    const { formatTerms, generateAgentKey, signActionProof, evaluateCase } = await import("@readbackhq/core");
    const { directCharge } = await import("./demo");
    const { buildCaseBundle } = await import("./cases");
    const pp = fakePayPal();
    const key = await generateAgentKey(true);
    const now = new Date("2026-11-08T15:00:00Z");
    const terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-11-08", end: "2027-03-31", fingerprint: key.fingerprint };
    pp.tokens.set("tok2", { id: "tok2", payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA2" } } });
    const client = paypalClient(ENV, pp.fetch);
    // The store charges her wallet itself: every term respected, no request from her agent.
    const proof = await signActionProof("tok2", "direct-charge", now.getTime() / 1000, key.privateKey, key.publicJwk);
    const charged = await directCharge(client, { tokenId: "tok2", proof }, now);
    if (!charged.ok) throw new Error(charged.failure.code);
    const disputeId = pp.openDispute(charged.captureId, "UNAUTHORISED");

    const r = await runDisputeAction(client, disputeId, { action: "refund_buyer" }, new Date("2026-11-09T12:00:00Z"));
    expect(r).toMatchObject({ ok: true, sent: true, via: "accept_claim" });
    const post = pp.posts.find((p) => p.path.endsWith("/accept-claim"))!;
    expect(post.body).toMatchObject({ accept_claim_type: "REFUND", note: expect.stringContaining("which supports the buyer") });
    expect((post.body as { note: string }).note).toContain(`npx @readbackhq/verify ${disputeId}`);

    // As in the sandbox (spike step 7): refunded at once, the note on record, the dispute still under review.
    expect(pp.disputes.get(disputeId)).toMatchObject({ status: "UNDER_REVIEW", evidences: [{ evidence_type: "OTHER", source: "SUBMITTED_BY_SELLER" }] });
    expect(await runDisputeAction(client, disputeId, { action: "refund_buyer" })).toMatchObject({ ok: true, sent: false, message: expect.stringMatching(/already refunded/) });

    // PayPal then resolves it for the buyer; the case reads that way, and another click sends nothing.
    pp.settle(disputeId);
    const after = await buildCaseBundle(disputeId, client, new Date("2026-11-09T12:05:00Z"));
    if (!after.ok) throw new Error(after.message);
    expect(after.bundle.dispute!.dispute_outcome).toMatchObject({ outcome_code: "RESOLVED_BUYER_FAVOUR", outcome_reason: "SELLER_ISSUED_REFUND" });
    expect((await evaluateCase(after.bundle)).classification.notes.join(" ")).toMatch(/fully refunded/);
    expect(await runDisputeAction(client, disputeId, { action: "refund_buyer" })).toMatchObject({ ok: true, sent: false, message: expect.stringMatching(/already resolved/) });
    expect(pp.posts.filter((p) => p.path.endsWith("/accept-claim"))).toHaveLength(1);
  });
});
