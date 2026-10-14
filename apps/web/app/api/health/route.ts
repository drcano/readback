// GET /api/health — liveness for Render's health check. Stateless, no PayPal calls.
import { groupFingerprint } from "@readback/core";

export function GET(): Response {
  // Touch core so a broken workspace import fails the health check, not the first real request.
  return Response.json({ ok: true, core: groupFingerprint("0000000000000000").length === 19 });
}
