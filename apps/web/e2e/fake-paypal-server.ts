// Serves lib/paypal/fake.ts over HTTP so the real Next.js server can be tested end to end
// without the sandbox. Test-only. Run: node e2e/fake-paypal-server.ts <port>
import { createServer } from "node:http";
import { fakePayPal } from "../lib/paypal/fake.ts";

const pp = fakePayPal();
const port = Number(process.argv[2] ?? 4555);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = `http://localhost:${port}${req.url}`;
  // Test hook: stands in for the judge clicking "Agree" on PayPal's page.
  if (req.url?.startsWith("/__approve/")) {
    pp.approve(req.url.slice("/__approve/".length));
    res.writeHead(204).end();
    return;
  }
  const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
  const r = await pp.fetch(url, { method: req.method, headers: req.headers as Record<string, string>, body });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`fake PayPal on :${port}`));
