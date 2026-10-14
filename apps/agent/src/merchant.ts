// How the runtime reaches the merchant's Readback deployment. Everything it returns is
// merchant-relayed (SPEC §5.2): it detects misconfiguration, not a dishonest merchant (T21).
import { z } from "zod";

export const AgreementViewSchema = z.object({
  ok: z.literal(true),
  tokenId: z.string(),
  active: z.boolean(),
  terms: z.string().nullable(),
  fingerprint: z.string().nullable(),
  charges: z.array(z.object({ captureId: z.string(), time: z.string(), period: z.number().nullable() })),
});
export type AgreementView = z.infer<typeof AgreementViewSchema>;

export type CheckoutReply =
  | { ok: true; orderId: string; captureId: string; invoiceId: string }
  | { ok: false; failures: { code: string; message: string }[] };

export type Merchant = {
  agreement(tokenId: string, opts?: { charges: boolean }): Promise<AgreementView | null>;
  checkout(mandate: string): Promise<CheckoutReply>;
  revoke(tokenId: string, proof: string): Promise<boolean>;
};

export function httpMerchant(baseUrl: string, fetchImpl: typeof fetch = fetch): Merchant {
  return {
    async agreement(tokenId, opts = { charges: true }) {
      const q = opts.charges ? "" : "?charges=false";
      const res = await fetchImpl(`${baseUrl}/api/agreements/${encodeURIComponent(tokenId)}${q}`).catch(() => null);
      const parsed = AgreementViewSchema.safeParse(await res?.json().catch(() => null));
      return parsed.success ? parsed.data : null;
    },
    async checkout(mandate) {
      const res = await fetchImpl(`${baseUrl}/api/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mandate }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as CheckoutReply | null;
      return body ?? { ok: false, failures: [{ code: "MERCHANT_UNREACHABLE", message: "The shop didn't answer; nothing was charged." }] };
    },
    async revoke(tokenId, proof) {
      const res = await fetchImpl(`${baseUrl}/api/agreements/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof }),
      }).catch(() => null);
      return res?.status === 204;
    },
  };
}
