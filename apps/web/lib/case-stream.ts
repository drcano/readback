// The case, rebuilt live (GET /api/cases/[id]?stream=1). It's one streamed response, NDJSON: each
// PayPal record as it's read, then the bundle and the server's result. The case view shows the
// records arriving, then re-runs every check itself (SPEC §5.6). Nothing outlives the request.
import { type CaseBundle, type CaseResult, evaluateCase } from "@readback/core";
import { buildCaseBundle } from "./cases";
import { paypalClient } from "./paypal/client";

export type CaseRecord = { label: string; api: string; id: string; status: number; ms: number };
export type CaseStreamEvent =
  | ({ type: "record" } & CaseRecord)
  | { type: "done"; ok: true; bundle: CaseBundle; result: CaseResult }
  | { type: "done"; ok: false; status: number; message: string };

// What each PayPal call is, in the case's own words. The first capture and order belong to the case.
// Later ones are earlier charges, checked as history: paid with her saved wallet, signed by her agent.
function describe(url: URL, seen: Set<string>): Omit<CaseRecord, "status" | "ms"> | null {
  const firstOf = (kind: string) => {
    if (seen.has(kind)) return false;
    seen.add(kind);
    return true;
  };
  const p = url.pathname;
  const last = decodeURIComponent(p.split("/").pop() ?? "");
  if (p.startsWith("/v1/customer/disputes/")) return { label: "The dispute", api: "Disputes", id: last };
  if (p === "/v1/customer/disputes") return { label: "Was that earlier charge disputed?", api: "Disputes", id: url.searchParams.get("disputed_transaction_id") ?? "" };
  if (p.startsWith("/v2/payments/captures/")) return { label: firstOf("capture") ? "The charge" : "An earlier charge", api: "Payments", id: last };
  if (p.startsWith("/v2/checkout/orders/")) return { label: firstOf("order") ? "The order, with the signed request" : "Its order: same wallet, same agent?", api: "Orders", id: last };
  if (p.startsWith("/v3/vault/payment-tokens/")) return { label: "Her approved terms", api: "Vault", id: last };
  if (p === "/v1/reporting/transactions") {
    const day = (k: string) => url.searchParams.get(k)?.slice(0, 10) ?? "";
    return { label: "Earlier charges under the agreement", api: "Transaction Search", id: `${day("start_date")} to ${day("end_date")}` };
  }
  return null; // signing in (OAuth) isn't a record of the case
}

export function streamCase(id: string, now: Date, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // A reader who leaves mid-build cancels the stream: no more PayPal calls for a page nobody sees.
  let gone = false;
  return new ReadableStream({
    async start(controller) {
      const send = (event: CaseStreamEvent) => {
        if (!gone) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const seen = new Set<string>();
      const watched: typeof fetch = async (input, init) => {
        if (gone) throw new Error("The reader left; this case isn't being read any more.");
        const url = new URL(input instanceof Request ? input.url : String(input));
        const t0 = performance.now();
        const res = await fetchImpl(input, init);
        const what = describe(url, seen);
        if (what) send({ type: "record", ...what, status: res.status, ms: Math.round(performance.now() - t0) });
        return res;
      };
      try {
        const lookup = await buildCaseBundle(id, paypalClient(env, watched), now);
        send(lookup.ok ? { type: "done", ok: true, bundle: lookup.bundle, result: await evaluateCase(lookup.bundle) } : { type: "done", ...lookup });
      } catch {
        send({ type: "done", ok: false, status: 502, message: "PayPal couldn't be reached for this case." });
      }
      if (!gone) controller.close();
    },
    cancel() {
      gone = true;
    },
  });
}
