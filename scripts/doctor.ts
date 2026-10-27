// pnpm run doctor — checks a deployment's configuration before a demo (SPEC §5.9). Prints PASS/FAIL
// per item and never prints secret values.
// Run locally: pnpm run doctor (plain `pnpm doctor` is pnpm's own built-in)  (reads .env and apps/agent/.env)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const results: [boolean, string][] = [];
const check = (ok: boolean, label: string) => results.push([ok, label]);

function readEnvFile(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  } catch {
    return {};
  }
}

const web = { ...readEnvFile(".env"), ...process.env } as Record<string, string | undefined>;
const agent = readEnvFile("apps/agent/.env");

check(Number(process.versions.node.split(".")[0]) >= 22, `Node ${process.versions.node} (need >= 22.18)`);
check(Boolean(web["PAYPAL_CLIENT_ID"] && web["PAYPAL_CLIENT_SECRET"]), "PayPal sandbox credentials set (.env)");
check((web["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com") === "https://api-m.sandbox.paypal.com", "PayPal base URL is the sandbox");
check(!web["AGENT_PRIVATE_KEY"], "AGENT_PRIVATE_KEY is NOT in the merchant .env (it belongs to apps/agent only)");
check(Boolean(agent["AGENT_PRIVATE_KEY"]), "AGENT_PRIVATE_KEY set (apps/agent/.env)");
check((agent["HERO_MCP_SECRET"] ?? "").length >= 16 && (agent["JUDGE_MCP_SECRET"] ?? "").length >= 16, "MCP path secrets are at least 16 characters");
check(Boolean(web["PAYPAL_WEBHOOK_ID"]), "PAYPAL_WEBHOOK_ID set (webhook verification)");
check(Boolean(web["MERCHANT_ADMIN_TOKEN"] && web["MERCHANT_ADMIN_TOKEN"].length >= 24), "MERCHANT_ADMIN_TOKEN set (24+ chars)");
check(Boolean(web["ANTHROPIC_API_KEY"]), "ANTHROPIC_API_KEY set (terms compiler, brief, chat panel)");
check(!web["HERO_MCP_SECRET"] && !web["JUDGE_MCP_SECRET"], "No MCP path secrets in the merchant .env (they belong to apps/agent only)");

// The repo is public: no secret value from either .env file may appear anywhere in git history.
const secrets = Object.entries({ ...readEnvFile(".env"), ...agent })
  .filter(([k]) => /SECRET|KEY|TOKEN/.test(k))
  .map(([, v]) => v.trim().replace(/^["']|["']$/g, ""))
  .filter((v) => v.length >= 8);
try {
  secrets.push((JSON.parse(agent["AGENT_PRIVATE_KEY"] ?? "") as { d: string }).d); // the key's private part on its own
} catch {}
const log = spawnSync("git", ["log", "-p", "--all"], { encoding: "utf8", maxBuffer: 1 << 28 });
// A truncated read (ENOBUFS) or a failed git must not pass as "clean".
const complete = !log.error && log.status === 0;
check(complete && secrets.every((s) => !log.stdout.includes(s)), complete ? `No secret from .env or apps/agent/.env is in git history (${secrets.length} checked)` : "Git history scan incomplete; can't confirm no secret was committed");

// Live checks: OAuth works, and the app can see Vault (a bogus token must 404, not 403).
if (web["PAYPAL_CLIENT_ID"] && web["PAYPAL_CLIENT_SECRET"]) {
  const base = web["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";
  const oauth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${web["PAYPAL_CLIENT_ID"]}:${web["PAYPAL_CLIENT_SECRET"]}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).catch(() => null);
  check(Boolean(oauth?.ok), "PayPal OAuth succeeds");
  if (oauth?.ok) {
    const { access_token, scope } = (await oauth.json()) as { access_token: string; scope?: string };
    check(Boolean(scope?.includes("vault")), "App token has a Vault scope (Vault enabled on the app)");
    check(Boolean(scope?.includes("disputes")), "App token has a Disputes scope");
    check(Boolean(scope?.includes("reporting")), "App token has a Reporting scope (Transaction Search)");
    const probe = await fetch(`${base}/v3/vault/payment-tokens/doctor-probe`, { headers: { Authorization: `Bearer ${access_token}` } }).catch(() => null);
    check(probe?.status === 404, `Vault reachable (bogus token → ${probe?.status ?? "no response"}, want 404)`);
  }
}

for (const [ok, label] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
process.exitCode = results.every(([ok]) => ok) ? 0 : 1;
