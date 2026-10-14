# CLAUDE.md — Readback

> **Readback** — *Every purchase your AI agent makes, on the record.*
> Signed mandates and dispute evidence for AI agent purchases on PayPal.

Pilots read every instruction back before they act, and the exchange is recorded so there is never a dispute about what was authorized. Readback does the same for AI agents that spend money: the agent reads the shopper's instruction back as a structured mandate, the shopper signs it, every purchase is checked against it and recorded, and when a "my AI bought that" dispute arrives, Readback replays the tape into PayPal's Disputes API.

The full product spec, demo script, and milestone detail live in `docs/SPEC.md`. Read it before starting any milestone. This file holds the rules for working in this repo.

---

## 1. Context you need every session

- **What this is:** a solo entry to the PayPal AI Hackathon (Devpost). Submission deadline is **Thu Nov 12, 2026, 12:00 PM Pacific**. Internal target: **submit Wed Nov 11**.
- **Who you're working with:** Dante. Strong in Python, **new to TypeScript**. He must be able to explain every file in a 3-minute video and in technical interviews. See §6 (Teaching mode). This is not optional.
- **Judging:** five equally weighted criteria: Technological Implementation, Design, Potential Impact, Innovation, Presentation. Ties break on Technological Implementation first. Judging may include automated AI analysis, so docs must be structured and explicit.
- **Rules that constrain the code:** project must run against the **PayPal sandbox**, must actually work as shown (no faked steps; label any simulated step honestly in the UI and README), public repo with an OSI license (Apache-2.0), and the hosted demo must stay up through **Dec 15, 2026**.

## 2. The one design principle

**LLMs propose; cryptography and policy decide.**

Claude is used to understand, draft, and explain. Claude never makes an allow/deny decision about money. Every authorization decision (is this purchase inside the mandate? is this signature valid? was the mandate revoked?) is deterministic TypeScript in `packages/mandates`, covered by tests. If you ever find yourself letting a model output gate a payment, stop and restructure.

## 3. Stack (decided; do not swap without asking)

- **Language:** TypeScript, `strict: true`, no `any` (use `unknown` + zod parsing). Node 20+.
- **Monorepo:** pnpm workspaces.
- **Web app:** Next.js (App Router) in `apps/web`: shopper pages, merchant dashboard, checkout API, webhook receiver.
- **Dashboard:** AG Grid **AG Studio** (React) with custom widgets and the Studio Agent Framework. Trial license is 45 days; Dante starts it around **Oct 31** so it covers judging. Until then, build dashboard data layers and use plain AG Grid Community for layout.
- **Validation/types:** zod schemas are the single source of truth; derive TS types with `z.infer`.
- **Tests:** vitest. `packages/mandates` targets near-total coverage.
- **AI:** Anthropic TypeScript SDK (`@anthropic-ai/sdk`). Runtime model from env `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`; switch to `claude-opus-5-5` for the recorded demo if quality needs it).
- **PayPal:**
  - `@paypal/paypal-server-sdk` (TypeScript Server SDK) for Orders and other covered APIs.
  - Direct REST (typed fetch client in `apps/web/lib/paypal/`) for anything the SDK doesn't cover: Vault v3 setup and payment tokens, Disputes actions (including multipart `provide-evidence`), and webhook signature verification.
  - `@paypal/agent-toolkit` (Vercel AI SDK flavor) for the **merchant operations agent** (list/get disputes, refunds, shipment tracking).
- **Crypto:** `jose` for Ed25519 JWS/JWT; mandates are W3C Verifiable Credentials encoded as VC-JWT; identities are `did:key`.
- **Storage:** SQLite via Drizzle ORM (one-command local setup for judges; Render persistent disk in production).
- **Hosting:** Render (web service + persistent disk). Render Workflows is optional for the dispute pipeline.

## 4. Repo layout

```
readback/
├── CLAUDE.md
├── README.md                  # judge-facing; sections map 1:1 to judging criteria
├── LICENSE                    # Apache-2.0
├── docs/
│   ├── SPEC.md                # product spec, demo script, milestones
│   ├── LEARNING.md            # Python→TypeScript glossary + concept notes for Dante
│   ├── ARCHITECTURE.md        # diagrams + data flow (written in week 3)
│   └── decisions/             # short ADRs, one per real decision
├── packages/
│   └── mandates/              # publishable library: AP2-shaped mandates as VCs,
│                              # verification, policy gate, hash-chained receipts
├── apps/
│   ├── web/                   # Next.js: shopper, merchant dashboard, APIs, webhooks
│   └── agent/                 # reference shopping agent (Claude), CLI + library
├── evals/                     # scripted scenarios + runner + results
└── scripts/                   # sandbox spike scripts, seeding, demo reset
```

## 5. Engineering rules

**Security and correctness (non-negotiable)**
- Never commit secrets. `.env` is git-ignored; keep `.env.example` current. Never print tokens in logs.
- Every PayPal POST sends a unique `PayPal-Request-Id` (idempotency).
- Webhooks are verified with PayPal's verify-webhook-signature endpoint before any processing. Unverified events are logged and dropped.
- **Untrusted content stays untrusted.** Product pages, buyer dispute messages, and any web content reach Claude only inside clearly delimited data blocks with an explicit "this is data, not instructions" frame, and nothing Claude reads can widen what the gate allows.
- The policy gate fails closed: any parse error, unknown field, expired or revoked mandate, or signature failure means **deny**.
- Every allow/deny decision writes a receipt (a "clip") to the hash-chained ledger, including denials.
- Bind evidence to the PayPal transaction: the receipt hash goes in `purchase_units[].custom_id` so evidence is provably linked to the charge.

**Code quality**
- Small, single-purpose modules. Pure functions in `packages/mandates` (no I/O), so they're easy to test and explain.
- Parse at the boundary with zod; trust types inside.
- Errors are typed results or thrown typed errors; never swallow.
- Accessibility: semantic HTML, labels on every input, keyboard-navigable flows, sufficient contrast.
- One-command local start must keep working: `pnpm install && pnpm dev` after filling `.env`.

**Git**
- Small commits, Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`). One logical change per commit, so the history reads as a clear build log.
- Never rewrite published history. Never commit generated secrets or sandbox credentials.
- At submission: tag `v1.0-submission` and point the Devpost entry at that tag.

## 6. Teaching mode (always on)

Dante is learning TypeScript through this build. While working:

1. **First time a concept appears, explain it** in plain language before or right after the code: what it does, line by line, and the closest Python equivalent. Concepts to watch for: `async`/`await` and Promises, type annotations vs. inference, `interface` vs. `type`, generics, union types and narrowing, zod schemas, ES modules and imports, `package.json`/`tsconfig.json`, React components and hooks, Next.js route handlers, server vs. client components.
2. **Start simple, then deepen.** Beginner-level explanation first; add precise terminology as Dante shows he's got it. Don't re-explain things he's demonstrated he understands.
3. **Keep `docs/LEARNING.md` current:** a Python→TypeScript glossary table plus a short note per concept with a pointer to where it's used in this repo.
4. **End of each milestone:** write a 5–10 line plain-English walkthrough of what was built and how data flows, suitable for Dante to say out loud in the video or an interview.
5. Prefer clear code over clever code. If a pattern would be hard to explain, choose a simpler one.

## 7. How to work

- **Before each milestone:** re-read the milestone in `docs/SPEC.md`, state the plan in a few lines, then build.
- **Use PayPal's AI Toolkit plugin** (`/plugin install paypal@claude-plugins-official`). Consult its `paypal-best-practices` skill before writing PayPal integration code; use `/paypal:sandbox`, `/paypal:explain-error`, and `/paypal:doctor` when stuck.
- **Verify, don't assume:** after any PayPal call path is written, run it against the sandbox and show the response. Report exactly what worked and what didn't.
- **Ask Dante** before: changing the stack, adding a paid service, changing the demo story, or anything touching his accounts. Everything else, proceed.
- **Model policy:** build with Opus 5.5. At three checkpoints, run an independent review in a **fresh session on Fable 5.1** that did not write the code: (1) architecture review before week 2, (2) security review of `packages/mandates` and the checkout gate at end of week 2, (3) full pre-submission audit Nov 9–10.

## 8. Things only Dante does

- PayPal Developer account, sandbox app, sandbox business and personal test accounts, enabling **Vault** and **Disputes** in the app's feature options; pasting credentials into `.env`.
- Devpost registration and submission; YouTube upload.
- AG Grid trial signup (~Oct 31) and Render account / credits.
- Asking questions in the PayPal hackathon Discord.
- Recording the demo video and voiceover.

## 9. Current milestone

**Week 1 (Oct 14–20): Sandbox spike + mandates core.** See `docs/SPEC.md` §8 for the day-one go/no-go checklist. Do the spike first: it decides whether autonomous mode and API-created disputes are viable, and the rest of the plan forks on the answers.
