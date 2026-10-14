// Canonical JSON: the same data always serializes to the same bytes, so its hash is stable.
// Object keys are sorted at every depth; arrays keep their order.
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
