import { describe, expect, it } from "vitest";
import { clientIp, limiter } from "./budget";

describe("rate limits", () => {
  it("limits per key per hour and per day, and resets the next day", () => {
    const allow = limiter(2, 3, "daily");
    const t = new Date("2026-11-08T10:00:00Z");
    expect(allow("a", t).ok).toBe(true);
    expect(allow("a", t).ok).toBe(true);
    expect(allow("a", t)).toMatchObject({ ok: false });
    expect(allow("b", t).ok).toBe(true);
    expect(allow("c", t)).toEqual({ ok: false, message: "daily" });
    expect(allow("c", new Date("2026-11-09T10:00:00Z")).ok).toBe(true);
  });
  it("uses the proxy-appended (last) X-Forwarded-For entry, not a client-supplied first one", () => {
    expect(clientIp(new Request("https://x", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request("https://x"))).toBe("local");
  });
});
