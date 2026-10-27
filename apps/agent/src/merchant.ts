// How the runtime reaches the merchant's Readback deployment. Everything it returns is
// merchant-relayed (SPEC §5.2): it detects misconfiguration, not a dishonest merchant (T21).
import { z } from "zod";

export const AgreementViewSchema = z.object({
  ok: z.literal(true),
  tokenId: z.string(),
  active: z.boolean(),
  terms: z.string().nullable(),
  fingerprint: z.string().nullable(),
  charges: z.array(z.object({ captureId: z.string(), time: z.string(), period: z.number().nullable(), amount: z.string().nullable().optional() })),
});
export type AgreementView = z.infer<typeof AgreementViewSchema>;

const Failures = z.array(z.object({ code: z.string(), message: z.string() })).min(1);
const CheckoutReplySchema = z.union([
  z.object({ ok: z.literal(true), orderId: z.string(), captureId: z.string(), invoiceId: z.string() }),
  z.object({ ok: z.literal(false), failures: Failures }),
]);
export type CheckoutReply = z.infer<typeof CheckoutReplySchema>;

// The shop couldn't give an answer (down, rate-limited, or PayPal unreachable behind it). Kept apart
// from "not active", so the shopper is never told something about her agreement that nobody checked.
export type Unavailable = { unavailable: string };
const UNREACHABLE = "the shop couldn't be reached right now, so nothing was checked or signed. Try again in a moment.";

export type Merchant = {
  agreement(tokenId: string, opts?: { charges: boolean }): Promise<AgreementView | Unavailable>;
  checkout(mandate: string): Promise<CheckoutReply>;
  revoke(tokenId: string, proof: string): Promise<{ ok: true } | { ok: false; message: string }>;
};

// The shop's own words when it gives them (a rate limit, a refused proof), else a plain fallback.
const messageOf = (body: unknown): string | null => {
  const b = (body ?? {}) as { message?: unknown; failure?: { message?: unknown } };
  const m = typeof b.message === "string" ? b.message : typeof b.failure?.message === "string" ? b.failure.message : null;
  return m && m.length <= 300 ? m : null;
};

export function httpMerchant(baseUrl: string, fetchImpl: typeof fetch = fetch): Merchant {
  return {
    async agreement(tokenId, opts = { charges: true }) {
      const q = opts.charges ? "" : "?charges=false";
      const res = await fetchImpl(`${baseUrl}/api/agreements/${encodeURIComponent(tokenId)}${q}`).catch(() => null);
      const body: unknown = await res?.json().catch(() => null);
      const parsed = AgreementViewSchema.safeParse(body);
      return parsed.success ? parsed.data : { unavailable: messageOf(body) ?? UNREACHABLE };
    },
    async checkout(mandate) {
      const res = await fetchImpl(`${baseUrl}/api/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mandate }),
      }).catch(() => null);
      const body: unknown = await res?.json().catch(() => null);
      const parsed = CheckoutReplySchema.safeParse(body);
      if (parsed.success) return parsed.data;
      // The shop answered in words but not with a decision (e.g. its rate limit): nothing was ordered.
      const said = messageOf(body);
      if (said) return { ok: false, failures: [{ code: "MERCHANT_REFUSED", message: said }] };
      return { ok: false, failures: [{ code: "MERCHANT_UNREACHABLE", message: "The shop didn't answer, so it's unclear whether the order went through. Asking again is safe: PayPal refuses a second charge this period." }] };
    },
    async revoke(tokenId, proof) {
      const res = await fetchImpl(`${baseUrl}/api/agreements/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof }),
      }).catch(() => null);
      if (res?.status === 204) return { ok: true };
      return { ok: false, message: messageOf(await res?.json().catch(() => null)) ?? "the shop couldn't be reached, so nothing was cancelled. Try again in a moment." };
    },
  };
}
