// GET /api/agreements/return — PayPal's return URL after approval. Exchanges the setup token for
// the payment token. Maya's flow redirects to her page (agreement ID in URL and cookie: client-held).
// Judge mode runs in a popup: it posts the agreement ID to the opener tab (same origin only) and
// closes, so the tab's in-memory key never navigates away (SPEC §5.7).
import { exchangeSetupToken, publicOrigin } from "@/lib/agreements";
import { allowExchange, clientIp } from "@/lib/budget";
import { paypalClient } from "@/lib/paypal/client";

// Inside <script>, "<" must be escaped so no value can close the tag early.
const scriptJson = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");

// Judge mode's popup always reports back to the opener tab (same origin only) and closes, whether the
// judge approved, cancelled, or the exchange failed, so the tab never waits on a window that's gone.
function popup(origin: string, message: Record<string, string>, text: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Readback</title><p>${text} You can close this window.</p>
<script>if (window.opener) { window.opener.postMessage(${scriptJson(message)}, ${scriptJson(origin)}); window.close(); }</script>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = publicOrigin(req); // not url.origin: behind Render's proxy that's localhost
  const judge = url.searchParams.get("flow") === "judge";
  if (judge && url.searchParams.get("cancelled")) return popup(origin, { type: "rb-agreement-cancelled" }, "Cancelled on PayPal; nothing was set up.");
  // [spike step 2] PayPal's query parameter name for the approved setup token.
  const setupTokenId = url.searchParams.get("approval_token_id") ?? url.searchParams.get("token");
  if (!setupTokenId || !/^[A-Za-z0-9_-]{1,64}$/.test(setupTokenId)) return new Response("Missing approval token.", { status: 400 });
  // Each hit is a PayPal POST (the exchange): rate-limited (T25), in its own bucket so approvals
  // started from the same IP can't strand one PayPal already completed.
  const gate = allowExchange(clientIp(req));
  const ex = gate.ok ? await exchangeSetupToken(paypalClient(), setupTokenId) : { ok: false as const };
  if (!ex.ok) return judge ? popup(origin, { type: "rb-agreement-failed" }, "PayPal's approval didn't complete.") : Response.redirect(`${origin}/shopper?error=exchange`, 303);
  if (judge) return popup(origin, { type: "rb-agreement", tokenId: ex.tokenId }, "Approved.");
  const res = Response.redirect(`${origin}/shopper?agreement=${encodeURIComponent(ex.tokenId)}`, 303);
  const headers = new Headers(res.headers);
  const secure = origin.startsWith("https:") ? "; Secure" : ""; // browsers drop Secure cookies on http://localhost
  headers.append("set-cookie", `rb_agreement=${encodeURIComponent(ex.tokenId)}; Path=/; SameSite=Lax${secure}; Max-Age=31536000`);
  return new Response(null, { status: 303, headers });
}
