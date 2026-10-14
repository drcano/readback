// Ephemeral per-instance rate limits holding no customer data, which "stores nothing" allows: a
// restart resets them (THREAT-MODEL T25, T32, T34).
// ponytail: per-instance only; with several instances the effective limit multiplies. Fine for one Render service.

export type Limiter = (key: string, now?: Date) => { ok: true } | { ok: false; message: string };

export function limiter(perKeyPerHour: number, perDay: number, dailyMessage: string): Limiter {
  let day = "";
  let today = 0;
  const perKey = new Map<string, { hour: number; n: number }>();
  return (key, now = new Date()) => {
    const d = now.toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      today = 0;
      perKey.clear();
    }
    if (today >= perDay) return { ok: false, message: dailyMessage };
    const hour = Math.floor(now.getTime() / 3_600_000);
    const e = perKey.get(key);
    const n = e && e.hour === hour ? e.n : 0;
    if (n >= perKeyPerHour) return { ok: false, message: "Too many requests; try again in a few minutes." };
    perKey.set(key, { hour, n: n + 1 });
    today++;
    return { ok: true };
  };
}

// Claude-backed routes: ~1 cent per call, so 500/day ≈ USD 5/day per instance.
export const allow = limiter(20, Number(process.env["ANTHROPIC_DAILY_CALLS"] ?? 500), "The demo's daily AI budget is used up. The rest of the demo still works.");
// Starting PayPal approvals (setup tokens) and demo direct charges: sandbox cost only, but bounded.
export const allowAgreement = limiter(10, 1000, "The demo has started enough agreements for today; try again tomorrow.");
export const allowDirectCharge = limiter(5, 500, "The demo has made enough direct charges for today.");

// The client IP as Render's proxy saw it: the LAST X-Forwarded-For entry is the one the proxy
// appended; earlier entries are whatever the client sent (audit finding 6).
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
}
