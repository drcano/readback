# Deploy: GitLab + Render

One page, in order, about an hour. Every step here uses Dante's accounts and secrets. The smoke check at the end says whether it worked. The demo-critical path must be green on the hosted URL by **Sun Nov 1** (CLAUDE.md §9), and the demo stays up through **Dec 15**.

## 0. Before the repo goes public
- [ ] `pnpm run doctor`. Every line passes except `PAYPAL_WEBHOOK_ID`, which comes in step 3. One check confirms that no secret value from `.env` or `apps/agent/.env` appears anywhere in git history (clean on Oct 26).
- [ ] `git status` is clean. `.env`, `apps/agent/.env` and `docs/LEARNING.md` are git-ignored and were never committed.

## 1. GitLab (public, Apache-2.0)
- [ ] On gitlab.com, create a blank project named `readback`, with visibility **Public** and no README.
- [ ] Push:
  ```bash
  git remote add gitlab git@gitlab.com:<you>/readback.git && git push -u gitlab main
  ```
- [ ] On the project page, the license shows Apache-2.0, and the README renders with its images.

## 2. Render (Blueprint: two Starter services)
- [ ] Go to **New → Blueprint**, connect GitLab, and pick `readback`. `render.yaml` defines `readback-web` and `readback-agent`.
- [ ] Fill in the `sync: false` values. Each service's URL is `https://<name>.onrender.com`, unless Render adds a suffix. If it does, fix the two URL values after the first deploy and redeploy.

| Service | Variable | Value |
|---|---|---|
| readback-web | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `MERCHANT_ADMIN_TOKEN` | From `.env` |
| readback-web | `AGENT_RUNTIME_URL` | `https://readback-agent.onrender.com` |
| readback-web | `HERO_AGREEMENT_ID` | `5td85928ph747680n` |
| readback-web | `PAYPAL_WEBHOOK_ID` | Empty until step 3 |
| readback-web | `JUDGE_AGREEMENT_ID` | Empty until step 4 |
| readback-web | `HERO_DISPUTE_ID`, `TWIST_DISPUTE_ID` | **Empty until the hero disputes exist.** Until then the home page shows the labeled pair. |
| readback-agent | `AGENT_PRIVATE_KEY` | From `apps/agent/.env`: the key that signed P001 onward. Any other key, and every tool refuses (T21). |
| readback-agent | `HERO_MCP_SECRET`, `JUDGE_MCP_SECRET` | From `apps/agent/.env` |
| readback-agent | `MERCHANT_URL` | `https://readback-web.onrender.com` |
| readback-agent | `HERO_AGREEMENT_ID`, `JUDGE_AGREEMENT_ID` | Same as on readback-web |

- [ ] Never put `AGENT_PRIVATE_KEY` or the MCP secrets on readback-web.
- [ ] Nothing to set for PayPal's return URLs. They're built from `RENDER_EXTERNAL_URL`, which Render sets itself. Without it they'd point at `https://localhost:10000`, which is what `next start` sees behind Render's proxy.
- [ ] Deploy, and wait for both health checks to go green.
- [ ] If the build or start fails on Node: `render.yaml` pins 22.18.0, but everything was tested on 26.5.0. Set `NODE_VERSION=26.5.0` on both services.

## 3. PayPal webhooks (sandbox app)
- [ ] Open developer.paypal.com → Apps & Credentials → Sandbox → the Readback app → Webhooks → **Add**.
  - URL: `https://readback-web.onrender.com/api/webhooks/paypal`
  - Events: `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`, `VAULT.PAYMENT-TOKEN.DELETED`
- [ ] Copy the webhook ID into `PAYPAL_WEBHOOK_ID` on readback-web, and redeploy.
- [ ] Spike step 5's buyer-side cancel can now be checked, because the webhook has a public URL.

## 4. Judges
- [ ] Create a judge sandbox buyer: Sandbox accounts → Create account → Personal, US. Never use Maya's account.
- [ ] Create the judge agreement with the hosted agent's key, then approve it **as the judge buyer**:
  ```bash
  pnpm agreement:create <fingerprint>
  ```
  Get the fingerprint with `pnpm --filter @readback/agent pubkey`. Set `JUDGE_AGREEMENT_ID` on both services and redeploy.
- [ ] Devpost testing instructions:
  - the hosted URL;
  - the judge buyer's sandbox email and password;
  - the judge MCP URL, `https://readback-agent.onrender.com/mcp/<JUDGE_MCP_SECRET>`. The path is the access control (T33).

## 5. Smoke check
- [ ] Run:
  ```bash
  pnpm smoke https://readback-web.onrender.com --agent https://readback-agent.onrender.com
  ```
  Everything should PASS. It's read-only: nothing changes at PayPal.
- [ ] Once the judge agreement exists, run it again with `--charge`. That signs a reorder on the judge path: at most one sandbox charge a day, and the second attempt must come back as PayPal's duplicate refusal.
- [ ] Re-run it read-only every day through Dec 15, and after every redeploy.

## 6. When the hero disputes exist (around Nov 7)
- [ ] Set `HERO_DISPUTE_ID` and `TWIST_DISPUTE_ID` on readback-web and redeploy. The smoke check then requires the hero to suggest `SELLER_FAVOR` and the twist `BUYER_FAVOR`, each re-checked from its bundle.
