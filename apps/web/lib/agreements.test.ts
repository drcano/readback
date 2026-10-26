import { generateAgentKey, parseTerms, signActionProof } from "@readback/core";
import { describe, expect, it } from "vitest";
import { createAgreement, exchangeSetupToken, fetchAgentKey, readAgreement, revokeAgreement } from "./agreements";
import { paypalClient } from "./paypal/client";
import { fakePayPal } from "./paypal/fake";

const ENV = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
const DRAFT = { sku: "GBP-SR24", qty: 1, periodDays: 1, capCents: 6500, end: "2027-03-31" };
const OPTS = { today: "2026-10-21", baseUrl: "https://readback.example", flow: "maya" as const };

describe("agreements", () => {
  it("create → approve → exchange: PayPal holds the terms with the agent's own fingerprint", async () => {
    const pp = fakePayPal();
    const client = paypalClient(ENV, pp.fetch);
    const agent = await generateAgentKey(true);
    const created = await createAgreement(client, DRAFT, agent.publicJwk, OPTS);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.terms).toBe(`RB1 Good Boy Provisions | GBP-SR24 x1/1d | max USD 65.00 | 2026-10-21..2027-03-31 | agent ${agent.fingerprint}`);
    const setupPost = pp.posts.find((p) => p.path === "/v3/vault/setup-tokens")!;
    expect(setupPost.requestId).toMatch(/^rb-setup-[0-9a-f]{40}$/);
    expect(setupPost.body).toMatchObject({ payment_source: { paypal: { experience_context: { return_url: "https://readback.example/api/agreements/return?flow=maya" } } } });

    expect((await exchangeSetupToken(client, created.setupTokenId)).ok).toBe(false); // not approved yet
    pp.approve(created.setupTokenId);
    const ex = await exchangeSetupToken(client, created.setupTokenId);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;

    const view = await readAgreement(client, ex.tokenId, new Date("2026-10-22T00:00:00Z"));
    expect(view).toMatchObject({ active: true, terms: created.terms, fingerprint: agent.fingerprint, charges: [] });
    expect(JSON.stringify(view)).not.toMatch(/MAYA00000001/); // no personal data in the public view
  });

  it("judge mode's cancel goes back through the return route, so the opener tab hears about it", async () => {
    const pp = fakePayPal();
    const created = await createAgreement(paypalClient(ENV, pp.fetch), DRAFT, (await generateAgentKey(false)).publicJwk, { ...OPTS, flow: "judge" });
    expect(created.ok).toBe(true);
    expect(pp.posts.find((p) => p.path === "/v3/vault/setup-tokens")!.body).toMatchObject({
      payment_source: { paypal: { experience_context: { return_url: "https://readback.example/api/agreements/return?flow=judge", cancel_url: "https://readback.example/api/agreements/return?flow=judge&cancelled=1" } } },
    });
  });

  it("refuses unknown items and terms outside the grammar's limits", async () => {
    const client = paypalClient(ENV, fakePayPal().fetch);
    const agent = await generateAgentKey(true);
    expect(await createAgreement(client, { ...DRAFT, sku: "NOPE" }, agent.publicJwk, OPTS)).toMatchObject({ ok: false, failure: { code: "UNKNOWN_ITEM" } });
    expect(await createAgreement(client, { ...DRAFT, qty: 1000 }, agent.publicJwk, OPTS)).toMatchObject({ ok: false, failure: { code: "TERMS_MALFORMED" } });
    expect(await createAgreement(client, { ...DRAFT, capCents: 0 }, agent.publicJwk, OPTS)).toMatchObject({ ok: false });
  });

  it("revoke needs a fresh proof from the agreement's own key, or the admin token", async () => {
    const pp = fakePayPal();
    const client = paypalClient(ENV, pp.fetch);
    const agent = await generateAgentKey(true);
    const other = await generateAgentKey(true);
    const created = await createAgreement(client, DRAFT, agent.publicJwk, OPTS);
    if (!created.ok) throw new Error("create");
    pp.approve(created.setupTokenId);
    const ex = await exchangeSetupToken(client, created.setupTokenId);
    if (!ex.ok) throw new Error("exchange");
    const now = 1_800_000_000;

    expect(await revokeAgreement(client, ex.tokenId, { adminOk: false }, now)).toMatchObject({ ok: false, status: 401 });
    const wrongKey = await signActionProof(ex.tokenId, "revoke", now, other.privateKey, other.publicJwk);
    expect(await revokeAgreement(client, ex.tokenId, { proof: wrongKey, adminOk: false }, now)).toMatchObject({ ok: false, failure: { code: "KEY_NOT_APPROVED" } });
    const wrongPurpose = await signActionProof(ex.tokenId, "direct-charge", now, agent.privateKey, agent.publicJwk);
    expect(await revokeAgreement(client, ex.tokenId, { proof: wrongPurpose, adminOk: false }, now)).toMatchObject({ ok: false, failure: { code: "ACTION_WRONG_PURPOSE" } });
    expect(pp.tokens.has(ex.tokenId)).toBe(true);

    const good = await signActionProof(ex.tokenId, "revoke", now, agent.privateKey, agent.publicJwk);
    expect(await revokeAgreement(client, ex.tokenId, { proof: good, adminOk: false }, now)).toEqual({ ok: true });
    expect(pp.tokens.has(ex.tokenId)).toBe(false);
    expect(await readAgreement(client, ex.tokenId, new Date())).toMatchObject({ active: false, terms: null });
  });

  it("fetches the agent key only in the expected shape", async () => {
    const agent = await generateAgentKey(true);
    const ok = (async () => Response.json({ jwk: agent.publicJwk, fingerprint: agent.fingerprint })) as typeof fetch;
    expect(await fetchAgentKey("https://agent.example", ok)).toEqual(agent.publicJwk);
    const evil = (async () => Response.json({ jwk: { ...agent.publicJwk, d: "x".repeat(43) } })) as typeof fetch;
    expect(await fetchAgentKey("https://agent.example", evil)).toBeNull();
    const down = (async () => { throw new Error("down"); }) as typeof fetch;
    expect(await fetchAgentKey("https://agent.example", down)).toBeNull();
  });

  it("terms built here parse in core", () => {
    expect(parseTerms(`RB1 Good Boy Provisions | GBP-SR24 x1/1d | max USD 65.00 | 2026-10-21..2027-03-31 | agent ${"a".repeat(16)}`).ok).toBe(true);
  });
});
