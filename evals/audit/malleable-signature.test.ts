// Audit Oct 25 regression suite (independent review; see docs/decisions/0006-audit-oct25.md).
// Probe: ECDSA signatures are malleable ((r, s) and (r, n−s) both verify). Readback identifies a
// mandate by sha256(JWS string), so one genuine agent signature yields TWO distinct "mandates".
import { authorizeCharge, evaluateCase, verifyMandate, requestIds, customId } from "@readback/core";
import { heroCase } from "@readback/core/fixtures";
import { base64url } from "jose";
import { describe, expect, it } from "vitest";

const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

function flipS(jws: string): string {
  const [h, p, sig] = jws.split(".") as [string, string, string];
  const raw = base64url.decode(sig);
  const s = BigInt("0x" + Buffer.from(raw.subarray(32)).toString("hex"));
  const s2 = (N - s).toString(16).padStart(64, "0");
  const out = new Uint8Array(64);
  out.set(raw.subarray(0, 32), 0);
  out.set(Buffer.from(s2, "hex"), 32);
  return `${h}.${p}.${base64url.encode(out)}`;
}

describe("signature malleability", () => {
  it("a flipped-s copy of a genuine mandate verifies with a different mandateHash but the same request IDs", async () => {
    const hero = await heroCase();
    const twin = flipS(hero.jws);
    expect(twin).not.toBe(hero.jws);
    const a = await verifyMandate(hero.jws);
    const b = await verifyMandate(twin);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value.payload).toEqual(a.value.payload);
    expect(b.value.mandateHash).not.toBe(a.value.mandateHash);
    // Request IDs come from the signed content, so the twin is the same request at PayPal (audit Oct 25).
    expect(b.value.requestHash).toBe(a.value.requestHash);
    const at = (jws: string) => authorizeCharge({ jws, token: hero.bundle.token, merchant: "Good Boy Provisions", itemName: "x", nowSec: hero.mandate.iat + 5 });
    const [g1, g2] = [await at(hero.jws), await at(twin)];
    expect(g1.allow && g2.allow && g1.requestIds.create === g2.requestIds.create).toBe(true);
  });

  it("a twin charged later in the same period is caught on its own case (check 7: not first in its period)", async () => {
    const hero = await heroCase();
    const twin = flipS(hero.jws);
    const b = structuredClone(hero.bundle);
    const pu = b.order.purchase_units[0]!;
    pu.items![0]!.description = twin;
    pu.custom_id = customId(b.token!.id, hero.termsHash, hero.mandate.p, (await verifyMandate(twin).then((v) => (v.ok ? v.value.mandateHash : "")))!);
    b.capture.custom_id = pu.custom_id;
    b.capture.id = "CAP-TWIN";
    b.capture.create_time = new Date((hero.mandate.iat + 60) * 1000).toISOString();
    b.history.push({ captureId: hero.bundle.capture.id, captureTime: new Date((hero.mandate.iat + 5) * 1000).toISOString(), customId: hero.bundle.order.purchase_units[0]!.custom_id, disputed: false, verified: true });
    const r = await evaluateCase(b);
    expect(r.failed).toContain("7");
    expect(r.classification.suggestion).toBe("BUYER_FAVOR");
  });

  it("control: a twin labeled with ANY other 16-hex also escapes the reuse check (malleability adds nothing here)", async () => {
    const hero = await heroCase();
    const b = structuredClone(hero.bundle);
    b.history.push({ captureId: "CAP-TWIN", captureTime: "2026-11-08T15:01:00Z", customId: customId(hero.bundle.token!.id, hero.termsHash, hero.mandate.p, "e".repeat(64)), disputed: false, verified: false });
    expect((await evaluateCase(b)).classification).toMatchObject({ row: 13, suggestion: "SELLER_FAVOR" });
  });
});
