// Hash-chained receipts ("clips"). Each clip stores the hash of the one before it,
// so editing, deleting, or reordering any clip breaks every hash after it.
import { z } from "zod";
import { canonicalize, sha256Hex } from "./canonical.ts";

export const CLIP_TYPES = [
  "MANDATE_SIGNED",
  "NOTICE_SENT",
  "GATE_ALLOW",
  "GATE_DENY",
  "CHARGE_CAPTURED",
  "SHIPMENT_TRACKED",
  "MANDATE_REVOKED",
  "DISPUTE_RECEIVED",
  "EVIDENCE_SUBMITTED",
] as const;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const ClipSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  type: z.enum(CLIP_TYPES),
  refs: z.record(z.string(), z.string()), // e.g. { intent_mandate_id: "...", order_id: "..." }
  reasons: z.array(z.string()),
  timestamp: z.iso.datetime(),
  prev_hash: hex64,
  hash: hex64,
});
export type Clip = z.infer<typeof ClipSchema>;

export type ClipInput = Pick<Clip, "type" | "refs" | "reasons" | "timestamp">;

export const GENESIS_HASH = "0".repeat(64);

function hashClip(clip: Omit<Clip, "hash">): string {
  return sha256Hex(canonicalize(clip));
}

// Pure: returns the next clip; the caller stores it.
export function nextClip(chain: readonly Clip[], input: ClipInput): Clip {
  const prev = chain.at(-1);
  const body = { ...input, seq: chain.length, prev_hash: prev ? prev.hash : GENESIS_HASH };
  return { ...body, hash: hashClip(body) };
}

export type ChainResult = { ok: true } | { ok: false; seq: number; reason: string };

// Takes unknown on purpose: a chain read back from disk or an evidence file is untrusted.
export function verifyChain(chain: readonly unknown[]): ChainResult {
  let prevHash = GENESIS_HASH;
  for (const [i, raw] of chain.entries()) {
    const parsed = ClipSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, seq: i, reason: "malformed clip" };
    const { hash, ...body } = parsed.data;
    if (body.seq !== i) return { ok: false, seq: i, reason: "seq out of order" };
    if (body.prev_hash !== prevHash) return { ok: false, seq: i, reason: "prev_hash mismatch" };
    if (hashClip(body) !== hash) return { ok: false, seq: i, reason: "hash mismatch" };
    prevHash = hash;
  }
  return { ok: true };
}
