// GET /api/agreements/return — PayPal's return URL after approval. Exchanges the setup token for
// the payment token. Maya's flow redirects to her page (agreement ID in URL and cookie: client-held).
// Judge mode runs in a popup: it posts the agreement ID to the opener tab (same origin only) and
// closes, so the tab's in-memory key never navigates away (SPEC §5.7).
import { exchangeSetupToken } from "@/lib/agreements";
import { paypalClient } from "@/lib/paypal/client";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // [spike step 2] PayPal's query parameter name for the approved setup token.
  const setupTokenId = url.searchParams.get("approval_token_id") ?? url.searchParams.get("token");
  if (!setupTokenId || !/^[A-Za-z0-9_-]{1,64}$/.test(setupTokenId)) return new Response("Missing approval token.", { status: 400 });
  const ex = await exchangeSetupToken(paypalClient(), setupTokenId);
  if (!ex.ok) return Response.redirect(`${url.origin}/shopper?error=exchange`, 303);

  if (url.searchParams.get("flow") === "judge") {
    const origin = JSON.stringify(url.origin);
    const tokenId = JSON.stringify(ex.tokenId);
    const html = `<!doctype html><meta charset="utf-8"><title>Approved</title><p>Approved. You can close this window.</p>
<script>if (window.opener) { window.opener.postMessage({ type: "rb-agreement", tokenId: ${tokenId} }, ${origin}); window.close(); }</script>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const res = Response.redirect(`${url.origin}/shopper?agreement=${encodeURIComponent(ex.tokenId)}`, 303);
  const headers = new Headers(res.headers);
  const secure = url.protocol === "https:" ? "; Secure" : ""; // browsers drop Secure cookies on http://localhost
  headers.append("set-cookie", `rb_agreement=${encodeURIComponent(ex.tokenId)}; Path=/; SameSite=Lax${secure}; Max-Age=31536000`);
  return new Response(null, { status: 303, headers });
}
