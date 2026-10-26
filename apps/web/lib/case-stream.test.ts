import { buildMandate, formatTerms, generateAgentKey, sha256Hex, signMandate, type Terms } from "@readback/core";
import { describe, expect, it } from "vitest";
import { type CaseStreamEvent, streamCase } from "./case-stream";
import { buildCaseBundle } from "./cases";
import { checkout } from "./checkout";
import { paypalClient } from "./paypal/client";
import { fakePayPal } from "./paypal/fake";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
const read = async (stream: ReadableStream<Uint8Array>) =>
  (await new Response(stream).text()).trim().split("\n").map((l) => JSON.parse(l) as CaseStreamEvent);

// Three daily signed charges through the real gate; she disputes the last.
async function disputedCase() {
  const pp = fakePayPal();
  const key = await generateAgentKey(true);
  const terms: Terms = { merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-01", end: "2027-03-31", fingerprint: key.fingerprint };
  pp.tokens.set("tok1", { id: "tok1", payment_source: { paypal: { description: formatTerms(terms), payer_id: "MAYA1" } } });
  const client = paypalClient(ENV, pp.fetch);
  let last = "";
  for (let day = 1; day <= 3; day++) {
    const iat = Date.parse(`2026-10-0${day}T15:00:00Z`) / 1000;
    pp.clock.now = new Date((iat + 5) * 1000).toISOString();
    const m = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: "tok1", terms, termsHash: await sha256Hex(formatTerms(terms)) }, iat, `stream-test-${day}`);
    if (!m.ok) throw new Error(m.error.code);
    const r = await checkout(await signMandate(m.value, key.privateKey, key.publicJwk), client, iat + 5);
    if (!r.ok) throw new Error(r.failures.map((f) => f.code).join());
    last = r.captureId;
  }
  const disputeId = pp.openDispute(last, "UNAUTHORISED");
  pp.calls.length = 0;
  return { pp, disputeId, now: new Date("2026-10-10T00:00:00Z") };
}

describe("streamCase (the case view's live rebuild)", () => {
  it("reports every PayPal record as it's read, in the case's words, then the same case the JSON route builds", async () => {
    const { pp, disputeId, now } = await disputedCase();
    const events = await read(streamCase(disputeId, now, ENV, pp.fetch));
    const records = events.flatMap((e) => (e.type === "record" ? [e] : []));
    expect(records).toHaveLength(pp.calls.length); // every PayPal call but signing in, once each
    expect(records.slice(0, 5).map((r) => r.label)).toEqual(["The dispute", "The charge", "The order, with the signed request", "Her approved terms", "Earlier charges under the agreement"]);
    expect(records[0]).toMatchObject({ api: "Disputes", id: disputeId, status: 200 });
    expect(records.slice(5).map((r) => r.label)).toContain("Was that earlier charge disputed?");

    const done = events.at(-1)!;
    const json = await buildCaseBundle(disputeId, paypalClient(ENV, pp.fetch), now);
    if (done.type !== "done" || !done.ok || !json.ok) throw new Error("expected a case");
    expect(done.bundle).toEqual(json.bundle);
  });

  it("stops calling PayPal when the reader leaves mid-build", async () => {
    const { pp, disputeId, now } = await disputedCase();
    pp.knobs.latencyMs = 30;
    const reader = streamCase(disputeId, now, ENV, pp.fetch).getReader();
    await reader.read(); // the dispute arrives; the charge is already being read
    await reader.cancel();
    const atCancel = pp.calls.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(pp.calls.length).toBeLessThanOrEqual(atCancel + 1); // the call in flight finishes; none start
  });

  it("ends with the plain refusal when PayPal doesn't have the case", async () => {
    const events = await read(streamCase("PP-D-NOPE", new Date(), ENV, fakePayPal().fetch));
    expect(events.at(-1)).toEqual({ type: "done", ok: false, status: 404, message: "Dispute not found at PayPal." });
  });
});
