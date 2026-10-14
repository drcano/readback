// Merchant write actions need MERCHANT_ADMIN_TOKEN, compared server-side in constant time.
import { createHash, timingSafeEqual } from "node:crypto";

export function isAdmin(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  const expected = env["MERCHANT_ADMIN_TOKEN"];
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || !given) return false;
  // Hash both sides so the comparison is constant-time even when lengths differ.
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}
