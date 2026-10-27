// Route-level edges (edge-case review, Oct 27): designed answers instead of 500s.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

describe("routes without a service behind them", () => {
  it("drafting terms with no Anthropic key answers with a designed message, not a 500", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { POST } = await import("../app/api/terms/compile/route");
    const res = await POST(new Request("http://x/api/terms/compile", { method: "POST", body: JSON.stringify({ instruction: "one bag of salmon a week" }) }));
    expect([res.status, ((await res.json()) as { message: string }).message]).toEqual([503, expect.stringMatching(/isn't connected/)]);
  });
});
