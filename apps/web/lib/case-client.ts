// Browser-side case loading, shared by the case view and the verdict pairs. Fixture IDs build the
// case in the browser; anything else comes from /api/cases (live PayPal data), and every caller
// re-runs the checks itself with readback-core.
import type { CaseBundle, CaseResult } from "@readbackhq/core";
import { fixtureCases } from "@readbackhq/core/fixtures";
import type { CaseRecord, CaseStreamEvent } from "./case-stream";

export type Loaded = { bundle: CaseBundle; server: CaseResult | null; fixture: boolean };

async function fromJson(res: Response): Promise<Loaded> {
  const body = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; bundle?: CaseBundle; result?: CaseResult; message?: string };
  if (!body.ok || !body.bundle) throw new Error(body.message ?? `Couldn't load this case (HTTP ${res.status}).`);
  return { bundle: body.bundle, server: body.result ?? null, fixture: false };
}

export async function loadCase(id: string): Promise<Loaded> {
  if (id.startsWith("fixture-")) {
    const wanted = { "fixture-hero": "PP-D-HERO1", "fixture-twist": "PP-D-TWIST" }[id] ?? id.slice("fixture-".length);
    const found = (await fixtureCases()).find((f) => f.id === wanted);
    if (!found) throw new Error("No such fixture.");
    return { bundle: found.bundle, server: null, fixture: true };
  }
  return fromJson(await fetch(`/api/cases/${encodeURIComponent(id)}`));
}

// The case view's load: the same case, streamed, reporting each PayPal record as it's read. A refusal
// before the stream starts (a bad ID, the rate limit) arrives as plain JSON.
export async function loadCaseLive(id: string, onRecord: (r: CaseRecord) => void, signal?: AbortSignal): Promise<Loaded> {
  if (id.startsWith("fixture-")) return loadCase(id);
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}?stream=1`, signal ? { signal } : {});
  if (!res.body || !res.headers.get("content-type")?.includes("ndjson")) return fromJson(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("PayPal's answer for this case was cut off; try again.");
    buffer += value;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const event = JSON.parse(buffer.slice(0, nl)) as CaseStreamEvent;
      buffer = buffer.slice(nl + 1);
      if (event.type === "record") onRecord(event);
      else if (event.ok) return { bundle: event.bundle, server: event.result, fixture: false };
      else throw new Error(event.message);
    }
  }
}
