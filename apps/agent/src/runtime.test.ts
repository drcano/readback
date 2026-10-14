// Drives the real MCP protocol (JSON-RPC over the streamable-HTTP fetch handler) in-process.
import { type AgentKey, formatTerms, generateAgentKey, type Terms, verifyActionProof, verifyMandate } from "@readback/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { AgreementView, Merchant } from "./merchant.ts";

const HERO = "heroagreement01";
const JUDGE = "judgeagreement1";
const CFG = { heroSecret: "h".repeat(24), heroAgreementId: HERO, judgeSecret: "j".repeat(24), judgeAgreementId: JUDGE };
const NOW = new Date("2026-11-08T15:00:00Z");
let key: AgentKey;

beforeAll(async () => {
  key = await generateAgentKey(true);
});

// A fake merchant deployment that records what the runtime sends it.
function fakeMerchant(fingerprint: string) {
  const terms = (fp: string): Terms => ({ merchant: "Good Boy Provisions", sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, start: "2026-10-21", end: "2027-03-31", fingerprint: fp });
  const sent: { checkout: string[]; revoke: { tokenId: string; proof: string }[] } = { checkout: [], revoke: [] };
  const views: Record<string, AgreementView> = {
    [HERO]: { ok: true, tokenId: HERO, active: true, terms: formatTerms(terms(fingerprint)), fingerprint, charges: [{ captureId: "CAP1", time: "2026-10-21T15:00:00Z", period: 1 }] },
    [JUDGE]: { ok: true, tokenId: JUDGE, active: true, terms: formatTerms(terms(fingerprint)), fingerprint, charges: [] },
  };
  const merchant: Merchant = {
    agreement: async (id) => views[id] ?? null,
    checkout: async (jws) => {
      sent.checkout.push(jws);
      return { ok: true, orderId: "ORDER1", captureId: "CAP9", invoiceId: `RB-${HERO}-P019` };
    },
    revoke: async (tokenId, proof) => {
      sent.revoke.push({ tokenId, proof });
      return true;
    },
  };
  return { merchant, sent, views };
}

let rpcId = 0;
async function rpc(app: (r: Request) => Promise<Response>, secret: string, method: string, params: unknown) {
  const res = await app(new Request(`http://agent.local/mcp/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  }));
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? body;
  return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: { code: number; message: string } };
}
const call = (app: (r: Request) => Promise<Response>, secret: string, name: string, args: unknown) => rpc(app, secret, "tools/call", { name, arguments: args });
const textOf = (r: Awaited<ReturnType<typeof rpc>>) => r.result?.content?.map((c) => c.text).join("\n") ?? r.error?.message ?? "";

describe("agent runtime over MCP", () => {
  it("serves its public key and fingerprint, never the private key", async () => {
    const app = createApp(CFG, { key, merchant: fakeMerchant(key.fingerprint).merchant, now: () => NOW });
    const body = (await (await app(new Request("http://agent.local/.well-known/agent-key"))).json()) as Record<string, unknown>;
    expect(body["fingerprint"]).toBe(key.fingerprint);
    expect(JSON.stringify(body)).not.toMatch(/"d"/);
  });

  it("hero path lists four tools; the judge path has no revoke", async () => {
    const app = createApp(CFG, { key, merchant: fakeMerchant(key.fingerprint).merchant, now: () => NOW });
    const hero = await rpc(app, CFG.heroSecret, "tools/list", {});
    const judge = await rpc(app, CFG.judgeSecret, "tools/list", {});
    expect(hero.result?.tools?.map((t) => t.name).sort()).toEqual(["browse_catalog", "my_agent_card", "request_reorder", "revoke_agreement"]);
    expect(judge.result?.tools?.map((t) => t.name).sort()).toEqual(["browse_catalog", "my_agent_card", "request_reorder"]);
    expect((await call(app, CFG.judgeSecret, "revoke_agreement", { agreement: JUDGE })).error).toBeDefined();
    expect((await app(new Request("http://agent.local/mcp/wrong-secret", { method: "POST" }))).status).toBe(404);
  });

  it("signs an in-terms reorder and submits it to the merchant's gate", async () => {
    const { merchant, sent } = fakeMerchant(key.fingerprint);
    const app = createApp(CFG, { key, merchant, now: () => NOW });
    const r = await call(app, CFG.heroSecret, "request_reorder", { agreement: HERO, sku: "GBP-SR24", quantity: 1 });
    expect(textOf(r)).toMatch(/Ordered: 1 × GBP-SR24/);
    const v = await verifyMandate(sent.checkout[0]!);
    expect(v.ok && v.value.payload).toMatchObject({ agr: HERO, sku: "GBP-SR24", unit: "64.99", p: 19 });
  });

  it("refuses what the attack pages push for, and sends nothing to the merchant", async () => {
    const { merchant, sent } = fakeMerchant(key.fingerprint);
    const app = createApp(CFG, { key, merchant, now: () => NOW });
    const attempts = [
      { sku: "GBP-PREMIUM", quantity: 3 }, // hidden instructions
      { sku: "GBP-SR24", quantity: 5 }, // fake system text: quantity bump
      { sku: "OTHER-SR24", quantity: 1 }, // merchant redirect
    ];
    for (const a of attempts) {
      const r = await call(app, CFG.heroSecret, "request_reorder", { agreement: HERO, ...a });
      expect(r.result?.isError, JSON.stringify(a)).toBe(true);
    }
    expect(sent.checkout).toEqual([]);
  });

  it("price swap: the signed price is the shop's listed price, never the page's", async () => {
    const { merchant, sent } = fakeMerchant(key.fingerprint);
    const app = createApp(CFG, { key, merchant, now: () => NOW });
    await call(app, CFG.heroSecret, "request_reorder", { agreement: HERO, sku: "GBP-SR24", quantity: 1 });
    const v = await verifyMandate(sent.checkout[0]!);
    expect(v.ok && v.value.payload.unit).toBe("64.99"); // not the attack page's 6.99
  });

  it("refuses other agreements on a path, and terms carrying another key (T21, T33)", async () => {
    const { merchant } = fakeMerchant("AAAAAAAAAAAAAAAA"); // merchant swapped in its own key
    const app = createApp(CFG, { key, merchant, now: () => NOW });
    expect(textOf(await call(app, CFG.heroSecret, "request_reorder", { agreement: HERO, sku: "GBP-SR24", quantity: 1 }))).toMatch(/different agent key/);
    const ok = createApp(CFG, { key, merchant: fakeMerchant(key.fingerprint).merchant, now: () => NOW });
    expect(textOf(await call(ok, CFG.judgeSecret, "request_reorder", { agreement: HERO, sku: "GBP-SR24", quantity: 1 }))).toMatch(/only serves its own agreement/);
  });

  it("revoke signs a fresh action proof the merchant can verify", async () => {
    const { merchant, sent } = fakeMerchant(key.fingerprint);
    const app = createApp(CFG, { key, merchant, now: () => NOW });
    expect(textOf(await call(app, CFG.heroSecret, "revoke_agreement", { agreement: HERO }))).toMatch(/Cancelled/);
    const v = await verifyActionProof(sent.revoke[0]!.proof, { tokenId: HERO, purpose: "revoke", termsFingerprint: key.fingerprint, nowSec: NOW.getTime() / 1000 });
    expect(v.ok).toBe(true);
  });

  it("the agent card shows the full grouped fingerprint and how to cancel", async () => {
    const app = createApp(CFG, { key, merchant: fakeMerchant(key.fingerprint).merchant, now: () => NOW });
    const card = textOf(await call(app, CFG.heroSecret, "my_agent_card", { agreement: HERO }));
    expect(card).toContain(key.fingerprint.match(/.{4}/g)!.join(" "));
    expect(card).toMatch(/Manage automatic payments/);
  });

  it("catalog results are wrapped as untrusted data", async () => {
    const app = createApp(CFG, { key, merchant: fakeMerchant(key.fingerprint).merchant, now: () => NOW });
    const t = textOf(await call(app, CFG.heroSecret, "browse_catalog", { query: "salmon" }));
    expect(t).toMatch(/^<untrusted_data source="catalog">/);
    expect(t).toMatch(/not instructions/);
  });

  it("refuses short path secrets at startup", () => {
    expect(() => createApp({ ...CFG, heroSecret: "short" }, { key, merchant: fakeMerchant(key.fingerprint).merchant, now: () => NOW })).toThrow();
  });
});
