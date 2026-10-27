# CLAUDE.md — Readback

> **Readback** — *The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.*
> Agent purchase mandates and dispute evidence, built entirely on PayPal's own records.

Pilots read every instruction back before they act, and the exchange is recorded so there is never a dispute about what was authorized. Readback does the same for AI agents that spend money:
1. The agent reads the shopper's instruction back as structured terms, including her agent's key fingerprint.
2. The shopper approves the terms on PayPal's own approval page.
3. Every purchase is a request signed by her agent and charged under that agreement.
4. When a "my AI bought that" dispute arrives, Readback rebuilds the tape from PayPal's records, verifies the signature, and checks everything against the terms. This follows AP2 v0.2's autonomous model, on rails PayPal already runs.

**Readback stores nothing. PayPal is the only system of record.** Maya, the shopper, is the hero of the story. The moment judges should remember is **"same claim, two verdicts"**:
- a signed, in-terms purchase she disowns: seller's favor;
- a charge the merchant made itself, with no request from her agent: buyer's favor, against the merchant running Readback.

The investigator queue and case view show that in one click, from PayPal's own data.

The full product spec, demo script, and milestone detail live in `docs/SPEC.md`. Read it before starting any milestone. `docs/WHY-PAYPAL.md` is the sourced case for PayPal (don't add claims to README or video copy that it doesn't support). `docs/THREAT-MODEL.md` lists every threat and mitigation; each mitigation must exist in code and in an eval. `docs/PROPOSAL-agent-terms.md` is the API change we propose to PayPal. This file holds the rules for working in this repo.

---

## 1. Context you need every session

- **What this is:** a solo entry to the PayPal AI Hackathon (Devpost). Deadline **Thu Nov 12, 2026, 12:00 PM Pacific**. Internal target: **submit Wed Nov 11**.
- **Who you're working with:** Dante. Strong in Python, **new to TypeScript**. He must be able to explain every file in a 3-minute video and in technical interviews. See §6 (Teaching mode). Not optional.
- **Judging:** five equally weighted criteria: Technological Implementation, Design, Potential Impact, Innovation, Presentation. Ties break on Technological Implementation first. Judging may include automated AI analysis, so docs must be structured and explicit.
- **Rules that constrain the code:** must run against the **PayPal sandbox**, must actually work as shown (no faked steps; label simulated or concept pieces honestly), public repo with Apache-2.0, hosted demo up through **Dec 15, 2026**.

## 2. The two design principles

1. **LLMs propose; cryptography and deterministic checks decide.**
   - Claude understands, drafts, and explains. Claude never makes an allow/deny decision about money or a dispute ruling.
   - Claude never holds or sees a key.
   - Every decision is deterministic TypeScript in `packages/readback-core`, covered by tests.
2. **Readback stores nothing; PayPal is the system of record.**
   - **Consent:** the approved terms, including the agent's key fingerprint, live in the payment token's `description`. It can't be edited after approval. `billing_plan` is sent for display on PayPal's approval page only (the page shows just its `name`, which carries the grouped fingerprint); PayPal does not return it. Agreements use `usage_pattern: RECURRING_PREPAID`.
   - **Purchases:** each lives in a PayPal order, made with `vault_id` and `stored_credential` and carrying:
     - the agent-signed closed mandate (compact JWS) in `purchase_units[0].items[0].description`;
     - `invoice_id = RB-<tokenId>-P<NNN>`, so PayPal rejects a second charge in the same period;
     - `custom_id = rb1:<tokenId>:<termsHash16>:p<NNN>:<mandateHash16>` (`:`-separated; Transaction Search rejects `|`);
     - a copy of the terms in `purchase_units[0].description`.
   - **Everything else:** delivery, disputes, and evidence live in PayPal.
   - **Readback's merchant side** reads, verifies, checks, and writes back to PayPal, and keeps nothing.
   - **Keys:** only the agent runtime (Maya's side) holds a private key. The merchant app and the investigator view only verify. **One labeled exception:** in judge mode, a judge's browser tab may hold a non-extractable demo key for that session (THREAT-MODEL T31).
   - **Trust:** the checks never trust what the merchant or Claude asserts. They rely only on PayPal objects, the approved terms, and signatures by the approved agent key. Exact formats are in SPEC §4.

## 3. Stack (decided; do not swap without asking)

- **Language:** TypeScript, `strict: true`, no `any` (use `unknown` + zod). Node 22+.
- **Monorepo:** pnpm workspaces.
- **Web app:** Next.js (App Router) in `apps/web`:
  - shopper pages and judge mode;
  - investigator queue and case view (with a Merchant role toggle; no separate merchant page);
  - stateless API routes: checkout gate, agreement lookup, disputes, webhooks, and the demo-only direct charge.
- **Developer packages:** `@readback/core` (published to npm from `packages/readback-core`) and `@readback/verify` (a CLI in `packages/verify-cli`, run with the merchant account's API credentials or by PayPal; it removes dependence on merchant-hosted code, not on API access).
- **Agent runtime:** `apps/agent`, a separate service. MCP server with the TypeScript MCP SDK v2 (`@modelcontextprotocol/server`, `createMcpHandler`, streamable HTTP, nothing held between requests), plus a scripted harness for evals. It holds the agent's **P-256** private key and **no PayPal credentials**.
- **Investigator queue:** AG Grid **AG Studio** (React), live from PayPal APIs. Build it as a **custom widget wrapping AG Grid**, with custom cell renderers (the four-light strip), theming, and the **Studio Agent Framework (core)**. The trial license is 45 days; Dante starts it on **Nov 1** so it covers judging, which ends Dec 15. Until then use AG Grid Community.
- **Validation/types:** zod schemas are the source of truth; types via `z.infer`.
- **Tests:** vitest and fast-check (property-based tamper fuzzing). `packages/readback-core` targets near-total coverage, using **recorded sandbox responses as fixtures**. axe-core accessibility checks in CI.
- **AI:** Anthropic TypeScript SDK (`@anthropic-ai/sdk`). Model from env `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`; `claude-opus-5-5` for the recorded demo if needed).
- **PayPal:**
  - `@paypal/paypal-server-sdk` for Orders and other covered APIs.
  - Typed REST client in `apps/web/lib/paypal/` for Vault v3 (setup/payment tokens), Disputes actions (multipart `provide-evidence`), Transaction Search, Shipment Tracking, and webhook verification.
  - `@paypal/agent-toolkit` (v1.11.0) is used only as the base for our toolkit PR (SPEC §5.8). Its dispute tools are list/get/accept. `accept_dispute_claim` has two bugs (SPEC §5.8); reproduce both before calling them confirmed. Call Disputes endpoints directly.
  - Shipment tracking uses Orders v2 `POST /v2/checkout/orders/{id}/track`. Not the deprecated `/v1/shipping/trackers-batch`.
- **Crypto:** `jose` 6.x over WebCrypto for **ES256 (P-256)** compact JWS (RFC 7515/7518; P-256 because AP2 v0.2's schema requires it for `cnf`) and RFC 7638 JWK thumbprints. Pin `algorithms: ['ES256']` and follow the JWS hygiene rules in SPEC §4.3. WebCrypto SHA-256 for hashes. The same code runs in Node and the browser. No other crypto libraries, and no hand-rolled crypto.
- **Storage:** **none.** No database, no disk writes, no caches that outlive a request.
- **Hosting:** Render, two stateless **Starter** web services (always on, no cold starts during judging; covered by Render's $50 credit) defined in a `render.yaml` Blueprint with health checks: the merchant app and the agent runtime, each with its own secrets. Hosting only; no Render Workflows (a project can win only one sponsor prize, and that's AG Grid).

## 4. Repo layout

```
readback/
├── CLAUDE.md
├── README.md                  # judge-facing; sections map 1:1 to judging criteria
├── LICENSE                    # Apache-2.0
├── docs/
│   ├── SPEC.md
│   ├── WHY-PAYPAL.md          # sourced case: problem, law, market, competition, hard questions
│   ├── THREAT-MODEL.md        # threats T1–T34, mitigations, what isn't stopped
│   ├── PROPOSAL-agent-terms.md # the API change we propose to PayPal
│   ├── LEARNING.md            # local only (git-ignored): Python→TypeScript notes for Dante
│   ├── ARCHITECTURE.md        # "PayPal is the system of record" diagram (week 3)
│   └── decisions/             # short ADRs; 0001-sandbox-spike.md is a public record
├── packages/
│   ├── verify-cli/            # npx @readback/verify <disputeId|captureId>
│   └── readback-core/         # pure, browser-safe: terms grammar, termsHash,
│                              # period math, JWK thumbprint, closed-mandate
│                              # sign/verify/match, invoice_id/custom_id,
│                              # the eleven checks, classification, AP2 import
├── apps/
│   ├── web/                   # Next.js: shopper, judge mode, investigator queue + case (Merchant role), API routes (SPEC §5.10)
│   └── agent/                 # agent runtime: MCP server (holds agent key), harness for evals
├── examples/
│   └── existing-paypal-merchant/  # the 10-line quick-start, runnable
├── evals/                     # scenarios, fixtures (recorded sandbox JSON), runner, results
└── scripts/                   # sandbox spike scripts, demo reset
```

## 5. Engineering rules

**Stores nothing (non-negotiable)**
- No database, no files written at runtime, no in-memory caches that survive a request, no queues holding data.
- Allowed: configuration in env vars (secrets, seeded demo IDs); read-only fixtures bundled in the repo; client-held identifiers (the shopper's agreement ID in her URL or cookie, and in her runtime's config); a judge-mode key held only in the judge's tab; ephemeral per-instance rate-limit counters holding no customer data.
- Never log PII or full PayPal objects. Log request IDs, outcome codes, and timings only.
- Everything shown in any UI is fetched live from PayPal (or computed from what was just fetched).
- If a feature seems to need stored state, stop and ask Dante; the answer is usually "derive it from PayPal" or "cut it."

**Security and correctness**
- Secrets only in environment variables on the server. Never in the browser, the repo, or logs. Keep `.env.example` current.
- Every PayPal POST sends a **deterministic** `PayPal-Request-Id` derived from the operation, so retries are no-ops. Order create uses `rb-<first 40 hex of requestHash>` (the SHA-256 of the mandate's signed content, `header.payload`, so both encodings of one ECDSA signature are the same request); capture and track IDs are derived from it. Never use a random ID for a retryable operation.
- Find a disputed charge through PayPal as far as PayPal goes: dispute → `seller_transaction_id` → capture → order. PayPal sends no vault echo (spike step 3), so the agreement is the one `custom_id`/`invoice_id` name, accepted only with PayPal's payer match. Labels can count against the merchant, never for it: only a signature by the agreement's key can favor the merchant (SPEC §5.6 check 2a).
- Money is parsed into integer cents and never compared as strings. USD only. Shipping, tax, and discounts are zero.
- Verify webhooks with PayPal's verify-webhook-signature endpoint before acting. Unverified events are dropped.
- **Untrusted content stays untrusted.** Product pages, buyer dispute messages, and web content reach Claude only inside clearly delimited data blocks framed as data, not instructions. Nothing Claude reads can widen what the gate allows.
- The gate fails closed. Any of these means **deny**:
  - a missing or invalid signature;
  - a key fingerprint that doesn't match the terms;
  - an expired mandate, or one for a different period;
  - a parse error, missing token, or unknown field;
  - an expired or revoked agreement;
  - a format over its length limit;
  - any check failure.
- The agent runtime fails closed too. It signs only requests that pass `readback-core`'s constraint check, and it refuses to operate under an agreement whose terms don't contain its own fingerprint (THREAT-MODEL T21).
- **The agent's private key** lives only in the agent runtime's environment. It is never sent to Claude, never put in a tool result, never logged, and never present in `apps/web` (the judge-mode tab key, THREAT-MODEL T31, is the only exception).
- Every charge carries the signed mandate, the terms copy, `custom_id`, and the period `invoice_id` exactly as SPEC §4 defines them. Map PayPal errors to denials: `DUPLICATE_INVOICE_ID` means already ordered this period; `AGREEMENT_ALREADY_CANCELLED`, `INVALID_VAULT_ID`, or `PERMISSION_DENIED` (what the sandbox returns for a deleted token) means agreement not active.
- All date math is UTC.
- **Never claim more than the evidence shows.** The investigator view labels secondary evidence. It gives no suggested ruling when consent authenticity is unverified, and it never asserts Seller Protection eligibility; show the capture's `seller_protection` field instead.
- **Merchant write actions** (send, accept and refund, evidence, track) require `MERCHANT_ADMIN_TOKEN`, compared server-side. On the public deployment, the Merchant toggle is view-only.
- **Agent tools are agreement-scoped.** Every runtime tool takes an `agreement` argument. On each call, the runtime re-fetches the terms and refuses unless they contain its own fingerprint. The runtime has two secret MCP paths, each accepting exactly one agreement from env: Dante's path only `HERO_AGREEMENT_ID`, the judge path only `JUDGE_AGREEMENT_ID`. The judge path has no revoke tool. Token IDs are visible on public pages, so the path, not the ID, is the control (THREAT-MODEL T33). Judges approve with a separate judge sandbox buyer account, never Maya's.
- **Public Claude-backed routes are budgeted:** per-IP rate limits, capped `max_tokens`, and an `ANTHROPIC_DAILY_CALLS` circuit breaker (THREAT-MODEL T34).
- **Action proofs** (`rb-action+jwt`, SPEC §4.7) authorize revoke and the demo direct charge.
- **Routes:** the full table (method, path, auth, PayPal calls) is SPEC §5.10. Don't add routes without updating it.
- **Demo-only code is fenced.** `POST /api/demo/direct-charge` ("Be a dishonest merchant") runs only when `DEMO_MODE=true` against the sandbox base URL. It refuses to start otherwise. It requires a JWS from the tab's key whose thumbprint matches the agreement's terms fingerprint (with a start date of today), uses `invoice_id = RB-<tokenId>-DIRECT` so PayPal allows only one per agreement, and is rate-limited (THREAT-MODEL T32).
- Use only real enum values from PayPal's OpenAPI specs (`github.com/paypal/paypal-rest-api-specifications`). For example, there is no `PROOF_OF_AUTHORIZATION` evidence type, and sandbox `adjudicate` takes only the outcome.

**Code quality**
- `packages/readback-core` is pure: functions take PayPal API objects (and keys or JWS strings) in and return results out. No I/O. **Browser-safe** (no `node:crypto`, `fs`, or Node-only APIs), so the investigator view can run the same checks, including signature verification, in the browser. Include a browser test.
- Parse at the boundary with zod; trust types inside.
- Typed errors; never swallow.
- **One design system.** Shared design tokens feed the Next.js pages and the AG Studio theme. The four-light component (Consent · Agent · Terms · Delivery) is reused everywhere. Every denial and error has a designed plain-language state. Use the `frontend-design` skill.
- Accessibility: semantic HTML, labels on every input, keyboard-navigable, sufficient contrast, lights never color-only. axe-core reports zero violations in CI.
- One-command local start keeps working: `pnpm install && pnpm dev` after filling `.env`.

**Git**
- Small commits, Conventional Commits. One logical change per commit, so the history reads as a clear build log.
- Never commit secrets or sandbox credentials. Recorded sandbox fixtures must have personal data scrubbed (emails, names, addresses replaced with fakes).
- At submission: tag `v1.0-submission`.

## 6. Teaching mode (always on)

Dante is learning TypeScript through this build:

1. **First time a concept appears, explain it** in plain language: what it does, line by line, and the closest Python equivalent. Watch for:
   - **TypeScript:** `async`/`await` and Promises; type annotations vs. inference; `interface` vs. `type`; generics; union types and narrowing; zod; ES modules; `package.json` and `tsconfig.json`.
   - **React and Next.js:** components and hooks; route handlers; server vs. client components.
   - **Crypto and protocols:** public/private keys and signatures; hashes vs. signatures; JWS and JWK thumbprints; MCP servers and tools.
2. **Start simple, then deepen** as he shows he's got it. Don't re-explain what he's demonstrated.
3. **Keep `docs/LEARNING.md` current (local only, git-ignored; never commit it):** Python→TypeScript glossary plus a short note per concept with where it's used in this repo.
4. **End of each milestone:** a 5–10 line plain-English walkthrough of what was built and how data flows, for Dante to say in the video or an interview.
5. Prefer clear code over clever code.

## 7. How to work

- **Before each milestone:** re-read it in `docs/SPEC.md`, state the plan in a few lines, then build.
- **Use PayPal's AI Toolkit plugin** (`/plugin install paypal@claude-plugins-official`). Consult `paypal-best-practices` before writing PayPal integration code; use `/paypal:sandbox`, `/paypal:explain-error`, `/paypal:doctor` when stuck.
- **Verify, don't assume:** run every PayPal call path against the sandbox and show the response. Record useful responses (scrubbed) as fixtures in `evals/fixtures/`.
- **Ask Dante** before: changing the stack, adding any storage, adding a paid service, changing the demo story, or anything touching his accounts. Otherwise proceed.
- **Model policy:** build with Opus 5.5. Three independent reviews in a **fresh Fable 5.1 session** that didn't write the code:
  1. Architecture review before week 2.
  2. Security review of `readback-core`, the agent runtime, and the gate at the end of week 2.
  3. Full pre-submission audit, Nov 10.

## 8. Things only Dante does

- PayPal Developer account, sandbox app, sandbox business and personal accounts, enabling **Vault** and **Disputes** in app feature options, credentials in `.env`.
- Devpost registration and submission; YouTube upload.
- AG Grid trial (start **Nov 1**; also ask AG Grid for an extension); Render account, $50 credits, two Starter services.
- Questions in the PayPal hackathon Discord:
  1. Are merchant-initiated charges on a vaulted PayPal wallet eligible for Seller Protection?
  2. When a buyer cancels an automatic payment in their PayPal settings, does that delete the vault payment token and fire `VAULT.PAYMENT-TOKEN.DELETED`?
  3. Do UNAUTHORISED disputes open in INQUIRY in sandbox?
- Confirm "block accidental payments" (unique invoice IDs) is on in the sandbox business account.
- Add the agent runtime as a custom connector in his Claude app (custom connectors work on every plan; Free allows one).
- Hand-open about 15 sandbox disputes in week 3 (API creation is limited-release), across the classifications, **on separate agreements**. **Never file a claim on the hero agreement:** an unauthorized claim makes PayPal delete it within minutes (spike step 7), so the hero pair (its signed charge and the twist charge) is read in preview mode.
- Run `pnpm seed:charge` on Oct 21, 23, and 28 at minimum, then daily from Nov 1 as needed (SPEC §2).
- Create two sandbox buyer accounts: Maya's (hero) and a judge account.
- **Build in public:** ask the Discord questions this week, open the toolkit PR early, and post short progress updates where PayPal's developer community will see them.
- **Decide whether to add a design/video teammate** (no team-size limit; teammates join via the Devpost project).
- **Check the Rules on third-party trademarks** before showing any assistant's interface in the video.
- Recording the demo video and voiceover (script and storyboard locked Nov 4; recording Nov 8–9).

## 9. Current milestone

**Week 1 (Oct 14–20): Sandbox spike (Oct 14–17), then core (Oct 18–20).** Do the spike in `docs/SPEC.md` §8 first, and publish its record as you go. Steps 1–4 (including PayPal's vault echo on orders), 7, and the crypto part of 9 are go/no-go. Use a standard merchant REST app, not a platform app:
- orders with our fields, including the ~600-character signed mandate in the item description;
- ES256 JWS and thumbprints with `jose` in Node 22 and the browser;
- terms in `description` round-trip;
- charging without the shopper;
- PayPal's duplicate-invoice guard;
- the dispute lifecycle (escalate → require-evidence → provide-evidence → adjudicate) and `disputed_transactions[]`.

**Demo-critical path, green on the hosted URL by Sun Nov 1 before anything else starts:** approve on PayPal → signed charge → PayPal refuses the duplicate → the case view shows both verdicts on the hero agreement, read in preview (`SELLER_FAVOR` for a signed in-terms charge, `BUYER_FAVOR` for an unsigned charge the merchant made directly), re-verified in the browser → a real dispute, on a test agreement, arrives and is answered. No claim is ever filed on the hero agreement (PayPal deletes it; spike step 7). Cut order if behind is in SPEC §9.

Record findings in `docs/decisions/0001-sandbox-spike.md` and save scrubbed responses as fixtures before writing `readback-core`.

**Hard date: Oct 21.** The first seed agreement must be live on the 1-day demo cadence, signed by script, even before the gate exists. The hero `SELLER_FAVOR` case needs at least 2 prior undisputed captures, the earliest at least 7 days before it, before recording on Nov 8. By Oct 20, generate the production agent key (`AGENT_PRIVATE_KEY`, the same value later deployed to the runtime) and a minimal `apps/agent` seed signer. Formats freeze Oct 20. Seed mandates are signed by `apps/agent` and submitted by a separate merchant-side script (`pnpm seed:charge`), which Dante runs on Oct 21, 23, and 28 at minimum (SPEC §2). The full day-by-day schedule is in SPEC §9.
