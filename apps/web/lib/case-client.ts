// Browser-side case loading, shared by the case view and the verdict pairs. Fixture IDs build the
// case in the browser; anything else comes from /api/cases (live PayPal data), and every caller
// re-runs the checks itself with readback-core.
import type { CaseBundle, CaseResult } from "@readback/core";
import { fixtureCases } from "@readback/core/fixtures";

export type Loaded = { bundle: CaseBundle; server: CaseResult | null; fixture: boolean };

export async function loadCase(id: string): Promise<Loaded> {
  if (id.startsWith("fixture-")) {
    const wanted = { "fixture-hero": "PP-D-HERO1", "fixture-twist": "PP-D-TWIST" }[id] ?? id.slice("fixture-".length);
    const found = (await fixtureCases()).find((f) => f.id === wanted);
    if (!found) throw new Error("No such fixture.");
    return { bundle: found.bundle, server: null, fixture: true };
  }
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}`);
  const body = (await res.json()) as { ok: boolean; bundle?: CaseBundle; result?: CaseResult; message?: string };
  if (!body.ok || !body.bundle) throw new Error(body.message ?? `Couldn't load this case (HTTP ${res.status}).`);
  return { bundle: body.bundle, server: body.result ?? null, fixture: false };
}
