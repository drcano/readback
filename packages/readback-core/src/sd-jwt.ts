// SD-JWT reading shared by the AP2 and Verifiable Intent imports. Browser-safe: jose + WebCrypto.
// Anything we can't reveal is treated as hidden, and hidden content is a failure, never a pass.
import { base64url } from "jose";

export type Json = unknown;
export const decodeJson = (part: string): Json => JSON.parse(new TextDecoder().decode(base64url.decode(part)));

// SHA-256 of the ASCII string, base64url: what SD-JWT uses for disclosure digests and sd_hash.
export async function digest(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url.encode(new Uint8Array(d));
}

export class Hidden extends Error {}

// An array element {"...": digest} stands for the disclosure with that digest.
export const digestRef = (el: Json): string | null =>
  el && typeof el === "object" && !Array.isArray(el) && Object.keys(el).length === 1 && "..." in el ? String((el as Record<string, Json>)["..."]) : null;

export function reveal(value: Json, disclosures: Map<string, Json>): Json {
  if (Array.isArray(value)) {
    return value.map((el) => {
      const ref = digestRef(el);
      if (ref !== null) {
        const d = disclosures.get(ref);
        if (d === undefined) throw new Hidden("an array element is still hidden");
        return reveal(d, disclosures);
      }
      return reveal(el, disclosures);
    });
  }
  if (value && typeof value === "object") {
    if ("_sd" in value) throw new Hidden("object properties are still hidden");
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reveal(v, disclosures)]));
  }
  return value;
}

// One level of an array: the elements disclosed in this presentation, skipping the ones that
// aren't. For selective disclosure by design (VI shows each party only its part); a skipped element
// can never count toward a pass. Nested references stay as they are, for the caller to resolve.
export function revealPresented(value: Json, disclosures: Map<string, Json>): Json[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((el) => {
    const ref = digestRef(el);
    if (ref === null) return [el];
    return disclosures.has(ref) ? [disclosures.get(ref)] : [];
  });
}

export type SdJwt = { jws: string; header: Record<string, Json>; payload: Record<string, Json>; disclosures: Map<string, Json> };

// "jwt~d1~d2~" → the JWT, its decoded header and payload, and a digest → value map of its disclosures.
export async function parseSdJwt(token: string): Promise<SdJwt> {
  const [jws, ...rest] = token.split("~");
  if (!jws || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jws)) throw new Error("not an SD-JWT");
  const disclosures = new Map<string, Json>();
  for (const d of rest.filter(Boolean)) {
    const arr = decodeJson(d);
    if (!Array.isArray(arr) || (arr.length !== 2 && arr.length !== 3)) throw new Error("malformed disclosure");
    disclosures.set(await digest(d), arr[arr.length - 1]);
  }
  const [h, p] = jws.split(".") as [string, string];
  return { jws, header: decodeJson(h) as Record<string, Json>, payload: decodeJson(p) as Record<string, Json>, disclosures };
}

export const obj = (v: Json): Record<string, Json> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {});
