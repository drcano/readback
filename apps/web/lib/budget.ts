// Cost guard for public Claude-backed routes (THREAT-MODEL T34). Ephemeral per-instance counters
// holding no customer data, which "stores nothing" allows: a restart resets them.
// ponytail: per-instance only; with several instances the effective limit multiplies. Fine for one Render service.
const PER_IP_PER_HOUR = 20;
const CALLS_PER_DAY = Number(process.env["ANTHROPIC_DAILY_CALLS"] ?? 500); // ~USD 5/day at ~1¢ per call

let day = "";
let callsToday = 0;
const perIp = new Map<string, { hour: number; n: number }>();

export function allow(ip: string, now = new Date()): { ok: true } | { ok: false; message: string } {
  const today = now.toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    callsToday = 0;
    perIp.clear();
  }
  if (callsToday >= CALLS_PER_DAY) return { ok: false, message: "The demo's daily AI budget is used up. The rest of the demo still works." };
  const hour = Math.floor(now.getTime() / 3_600_000);
  const entry = perIp.get(ip);
  const n = entry && entry.hour === hour ? entry.n : 0;
  if (n >= PER_IP_PER_HOUR) return { ok: false, message: "Too many requests; try again in a few minutes." };
  perIp.set(ip, { hour, n: n + 1 });
  callsToday++;
  return { ok: true };
}
