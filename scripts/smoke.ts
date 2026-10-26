// pnpm smoke <web-url> [--agent <agent-url>] [--charge]
// Checks a deployment the way a judge meets it, around the demo-critical path (CLAUDE.md §9):
// - both services are up, and PayPal sends approvers back to this deployment;
// - the home page's verdict pair is re-checked here from the bundles the server returns;
// - the gate and the admin routes fail closed;
// - the hosted agent serves only its public key, which is the key the agreements name (T21).
// Read-only by default: nothing changes at PayPal. --charge asks the judge path for a reorder twice;
// that's at most one sandbox charge a day, and the second must be PayPal's duplicate refusal.
// Approving on PayPal and opening disputes need a person, so they aren't here. Never prints secrets.
// Reads HERO_/JUDGE_AGREEMENT_ID from .env, and the MCP path secrets from apps/agent/.env.
import { readFileSync } from "node:fs";
import { agentFingerprint, type CaseBundle, type CaseResult, evaluateCase, groupFingerprint, parseTerms, PublicJwkSchema } from "@readback/core";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const web = args[0]?.replace(/\/+$/, "");
if (!web || !/^https?:\/\//.test(web)) {
  console.error("Usage: pnpm smoke <web-url> [--agent <agent-url>] [--charge]");
  process.exit(2);
}
const agent = opt("--agent")?.replace(/\/+$/, "");
const agentEnv = (() => {
  try {
    return readFileSync("apps/agent/.env", "utf8");
  } catch {
    return "";
  }
})();
const secretOf = (name: string) => process.env[name] || agentEnv.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();

const rows: ["PASS" | "FAIL" | "INFO", string][] = [];
const check = (ok: boolean, label: string) => rows.push([ok ? "PASS" : "FAIL", label]);
const info = (label: string) => rows.push(["INFO", label]);

async function call(url: string, init?: RequestInit): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(60_000) }).catch(() => null);
  return { status: res?.status ?? 0, text: res ? await res.text() : "" };
}
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const post = (url: string, body: unknown) => call(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// One stateless JSON-RPC call to the agent runtime, which holds nothing between requests.
async function mcp(secret: string, name: string, toolArgs: unknown): Promise<string> {
  const r = await call(`${agent}/mcp/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArgs } }),
  });
  const data = r.text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? r.text;
  const body = parse(data) as { result?: { content?: { text: string }[] }; error?: { message: string } } | null;
  return body?.result?.content?.map((c) => c.text).join("\n") ?? body?.error?.message ?? `HTTP ${r.status}`;
}

// 1. The web app, and the pages a judge opens.
const health = await call(`${web}/api/health`);
check(health.status === 200 && (parse(health.text) as { core?: boolean } | null)?.core === true, `Web app is up (/api/health → ${health.status})`);
const pages = ["/", "/shopper", "/investigator", "/judge", "/ap2"];
const html = await Promise.all(pages.map((p) => call(`${web}${p}`)));
pages.forEach((p, i) => check(html[i]!.status === 200, `Page ${p} → ${html[i]!.status}`));

// 2. PayPal's return and cancel URLs come back to this deployment. A wrong origin sends approvers to
// localhost, and the judge popup's message never reaches the tab.
const back = await call(`${web}/api/agreements/return?flow=judge&cancelled=1`);
const target = /postMessage\([^,]+,\s*"([^"]+)"\)/.exec(back.text)?.[1];
check(target === new URL(web).origin, `PayPal sends approvers back to this deployment (return pages report to ${target ?? "nothing"})`);

// 3. The verdict pair on the home page: live disputes once HERO_/TWIST_DISPUTE_ID are set. Each case is
// re-checked here from its bundle, independently of the server's result.
const prop = (name: string) => new RegExp(`${name}\\\\?":\\\\?"([A-Za-z0-9-]{1,64})`).exec(html[0]!.text)?.[1];
const pair = [["hero", prop("heroId"), "SELLER_FAVOR"], ["twist", prop("twistId"), "BUYER_FAVOR"]] as const;
if (!pair[0][1] || !pair[1][1]) info("Home page shows the labeled pair: HERO_DISPUTE_ID and TWIST_DISPUTE_ID aren't both set");
else {
  for (const [side, id, want] of pair) {
    const r = await call(`${web}/api/cases/${id}`);
    const body = parse(r.text) as { ok?: boolean; bundle?: CaseBundle; result?: CaseResult } | null;
    if (!body?.ok || !body.bundle || !body.result) {
      check(false, `The ${side} case ${id} loads (HTTP ${r.status})`);
      continue;
    }
    const mine = (await evaluateCase(body.bundle)).classification;
    const theirs = body.result.classification;
    check(mine.row === theirs.row && mine.suggestion === theirs.suggestion, `The ${side} case ${id}, re-checked here, matches the server (row ${mine.row})`);
    check(mine.suggestion === want, `The ${side} case suggests ${want} (it suggests ${mine.suggestion ?? "nothing"})`);
    const outcome = body.bundle.dispute?.dispute_outcome?.outcome_code;
    if (outcome) info(`The ${side} case: PayPal's ruling is ${outcome}`);
  }
}

// 4. The queue, live from PayPal.
const q = await call(`${web}/api/queue`);
const queue = parse(q.text) as { rows?: { source: string }[]; liveError?: string; notices?: string[] } | null;
const live = queue?.rows?.filter((r) => r.source === "Live").length ?? 0;
check(q.status === 200 && Array.isArray(queue?.rows) && !queue?.liveError, `Queue loads from PayPal: ${live} live, ${(queue?.rows?.length ?? 0) - live} labeled${queue?.liveError ? `. ${queue.liveError}` : ""}`);
for (const n of queue?.notices ?? []) info(`Queue: ${n}`);

// 5. Fails closed: a forged request, a dispute action without the admin token, a bad demo proof.
const forged = await post(`${web}/api/checkout`, { mandate: "eyJhbGciOiJFUzI1NiJ9.e30.c2ln" });
check(forged.status >= 400 && (parse(forged.text) as { ok?: boolean } | null)?.ok === false, `The checkout gate refuses a forged request (HTTP ${forged.status})`);
const noToken = await post(`${web}/api/cases/PP-D-SMOKE0000/actions`, { action: "send_evidence" });
check(noToken.status === 401, `Dispute actions need the store's admin token (HTTP ${noToken.status})`);
// Off, the route is a plain 404; on, an unknown agreement is a JSON refusal (also 404).
const demo = await post(`${web}/api/demo/direct-charge`, { tokenId: "smoke0000", proof: "x" });
const demoOn = Boolean((parse(demo.text) as { failure?: { code?: string } } | null)?.failure?.code);
check(demoOn && demo.status >= 400, demoOn ? `Judge mode's direct charge is on, and refuses a bad request (HTTP ${demo.status})` : "Judge mode's direct charge is off: DEMO_MODE isn't true");
const hook = await post(`${web}/api/webhooks/paypal`, {});
check(hook.status === 200, `The webhook endpoint answers (HTTP ${hook.status}); unverified events are dropped`);

// 6. The agent runtime serves only its public key, and that's the key the agreements name (T21).
let agentFp: string | null = null;
if (!agent) info("No --agent URL, so the agent runtime checks are skipped");
else {
  const h = await call(`${agent}/health`);
  check(h.status === 200, `Agent runtime is up (/health → ${h.status})`);
  const k = parse((await call(`${agent}/.well-known/agent-key`)).text) as { jwk?: Record<string, unknown>; fingerprint?: string } | null;
  check(Boolean(k?.jwk) && !("d" in (k?.jwk ?? {})), "The agent key endpoint serves a public key only");
  const jwk = PublicJwkSchema.safeParse(k?.jwk);
  if (jwk.success) {
    agentFp = await agentFingerprint(jwk.data);
    check(agentFp === k?.fingerprint, `The agent's fingerprint ${groupFingerprint(agentFp)} matches its public key`);
  }
  const wrong = await post(`${agent}/mcp/smoke-not-a-secret`, {});
  check(wrong.status === 404, `MCP tools need a secret path (a wrong path → ${wrong.status})`);
}
const agreements = [["Hero", process.env["HERO_AGREEMENT_ID"], "HERO_MCP_SECRET"], ["Judge", process.env["JUDGE_AGREEMENT_ID"], "JUDGE_MCP_SECRET"]] as const;
const terms: Record<string, string | null> = {};
for (const [name, id, secretName] of agreements) {
  if (!id) {
    info(`${name} agreement: ${name.toUpperCase()}_AGREEMENT_ID isn't set here, so it's skipped`);
    continue;
  }
  const a = parse((await call(`${web}/api/agreements/${id}?charges=false`)).text) as { ok?: boolean; active?: boolean; terms?: string | null; fingerprint?: string | null } | null;
  terms[name] = a?.terms ?? null;
  check(a?.ok === true && a.active === true, `${name} agreement ${id} is active on PayPal`);
  if (agentFp) check(a?.fingerprint === agentFp, `${name} agreement's terms name the hosted agent's key`);
  const secret = secretOf(secretName);
  if (agent && secret) {
    const card = await mcp(secret, "my_agent_card", { agreement: id });
    check(!card.startsWith("Refused") && !card.startsWith("HTTP"), `${name} MCP path answers for its agreement (my_agent_card)`);
  }
}

// 7. --charge: the runtime signs, the gate verifies and PayPal charges; then PayPal refuses a second.
if (args.includes("--charge")) {
  const id = process.env["JUDGE_AGREEMENT_ID"];
  const secret = secretOf("JUDGE_MCP_SECRET");
  const parsed = terms["Judge"] ? parseTerms(terms["Judge"]) : null;
  if (!agent || !id || !secret || !parsed?.ok) check(false, "--charge needs --agent, an active JUDGE_AGREEMENT_ID and JUDGE_MCP_SECRET");
  else {
    const reorder = () => mcp(secret, "request_reorder", { agreement: id, sku: parsed.value.sku, quantity: 1 });
    const first = await reorder();
    check(/^Ordered:|Already ordered this period/.test(first), `Judge path, signed reorder: ${first}`);
    const second = await reorder();
    check(/Already ordered this period/.test(second), `Judge path, a second reorder this period: ${second}`);
  }
}

for (const [state, label] of rows) console.log(`${state}  ${label}`);
process.exitCode = rows.some(([s]) => s === "FAIL") ? 1 : 0;
