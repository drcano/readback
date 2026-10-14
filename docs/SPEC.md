# Readback — Product Spec

*Every purchase your AI agent makes, on the record.*

Companion to `CLAUDE.md`. This document is the source of truth for what we build, why, the demo story, and the schedule.

---

## 1. Problem

AI agents are starting to buy things for people. When a shopper later says "my AI bought that, not me," nobody can prove what the shopper actually authorized:

- **Liability is unassigned.** Card-network and wallet dispute rules were written for two parties (buyer and seller). No rule assigns fault among shopper, AI provider, and merchant for an agent purchase, so merchants absorb it by default.
- **Merchants feel it.** In PayPal's own commissioned UK merchant research (Apr 2026), merchants were split on who should bear agentic dispute costs, few thought the payment provider should, and there was widespread support for a standardized liability framework.
- **The evidence doesn't exist yet.** Industry guidance says winning these disputes needs new evidence (delegated authority, purchase parameters, notification timestamps), and that no tool captures mandate evidence today.
- **The saved-wallet trap.** Autonomous agent payments run on a saved payment method (a billing agreement). UK Financial Ombudsman decisions show that a billing agreement alone is not treated as consent to a specific charge; when nobody can show what was agreed, PayPal and merchants lose.
- **Seller Protection is narrow.** It covers only Unauthorized Transaction and Item Not Received claims, with conditions; Not-As-Described claims are funded entirely by the seller. Disputes also cost a $15 fee ($30 at a dispute ratio ≥ 1.5%).

**PayPal has said it wants this.** In its AP2 announcement, PayPal described mandates as giving merchants dispute-grade evidence and listed extending Seller Protection workflows with Cart and Intent Mandates as a goal. AP2's current version covers human-present purchases; human-not-present and recurring purchases are on its roadmap. Readback implements that roadmap path on PayPal rails, today.

## 2. Users and story

- **Shopper:** Maya, who has her agent reorder her dog Biscuit's food.
- **Merchant:** Sam, owner of *Good Boy Provisions* (fictional), a small independent online pet supply shop. Uses PayPal; handles disputes manually today.
- **Why replenishment:** it's the category consumers actually trust agents to buy autonomously (groceries/household, personal care, pet supplies lead in surveys), it's a standing preference rather than a judgment call, and caps are realistic (most consumers cap autonomous spend under ~$50–$100).

**Demo mandate:** "Reorder Biscuit's Salmon & Rice Adult (24 lb) from Good Boy Provisions, at most one bag every 30 days, up to $65 a month, through March 31, 2027. Notify me 48 hours before each order."

## 3. Product surfaces

1. **Shopper: Readback and sign** (`apps/web/app/shopper`)
   - Maya types the instruction in plain English.
   - Claude compiles it into a structured Intent Mandate and shows the **readback**: the structured fields plus a plain-language restatement (AP2 "prompt playback").
   - Maya edits/approves, then approves the PayPal saved-wallet flow (Vault setup token). Approval binds her PayPal customer to the mandate; her device key signs the mandate (VC-JWT).
   - "Recording" indicator shows the mandate is active. Manage page: view mandates, see every clip, revoke instantly.
   - Pre-charge notice 48h before each order with one-tap cancel. Notice timestamps are recorded as clips.
2. **Reference shopping agent** (`apps/agent`)
   - Claude-powered agent that browses the merchant catalog (fixture pages, including attack pages), assembles a cart, and submits it **only** through the merchant's gated checkout API, presenting the signed mandate. It has no direct payment tools.
3. **Merchant checkout gate** (`apps/web/app/api/checkout`)
   - Verifies the mandate signature, issuer, holder, validity window, revocation status, merchant, SKU allowlist, unit price, per-period amount and quantity caps.
   - On allow: merchant signs a Cart Mandate, creates a PayPal order charged to the vault payment token with `custom_id` = receipt hash, captures, records clips, pushes shipment tracking.
   - On deny: records a DENY clip with reasons. Fails closed.
4. **Merchant dashboard** (`apps/web/app/merchant`, AG Studio)
   - Dispute queue: reason, stage, response deadline countdown, mandate verification badge, recommended action.
   - **Tape viewer** (custom widget): the full clip timeline for a purchase (mandate → notice → cart → charge → shipment → dispute).
   - Gate activity: allows, denies, blocked injection attempts.
   - Money: fees avoided, dispute ratio vs. the 1.5% line.
   - Studio Agent Framework: Sam asks in plain English ("agent-initiated disputes this month where the mandate verified").
5. **Dispute pipeline** (`apps/web/lib/disputes`)
   - Webhook → fetch dispute → follow `custom_id` to the clip chain → verify the whole chain → deterministic triage → Claude drafts → Sam approves → submit via Disputes API.

## 4. Data model

All shapes follow AP2 field names where AP2 defines them. Encoded as W3C Verifiable Credentials (VC-JWT, Ed25519, `did:key`).

**IntentMandate** (issuer: shopper; holder: agent; human-not-present)
- `id`, `issuer` (shopper DID), `holder` (agent DID)
- `payer`: PayPal customer ID from Vault; `payee`: merchant ID
- `chargeable_payment_methods`: reference to the vault payment token (never the token secret)
- `shopping_intent`: `skus[]`, `max_unit_price`, `max_amount_per_period {value, currency}`, `period` (ISO 8601, e.g. `P30D`), `max_quantity_per_period`, `merchants[]`
- `prompt_playback`: the plain-language restatement the shopper approved
- `notification_policy`: `{ pre_charge_notice_hours: 48 }`
- `risk_payload`: open object (device, IP hash, approval timestamps)
- `user_present: false`, `valid_from`, `expires_at`

**CartMandate** (issuer: merchant): `id`, `intent_mandate_id`, `items[] {sku, qty, unit_price}`, `total`, `timestamp`, merchant signature.

**PaymentMandate**: `payment_mandate_id`, `cart_mandate_id`, `total`, `agent_presence: true`, `modality: HUMAN_NOT_PRESENT`, PayPal `order_id` / `capture_id` once known.

**Clip** (hash-chained receipt; append-only): `seq`, `type` (`MANDATE_SIGNED | NOTICE_SENT | GATE_ALLOW | GATE_DENY | CHARGE_CAPTURED | SHIPMENT_TRACKED | MANDATE_REVOKED | DISPUTE_RECEIVED | EVIDENCE_SUBMITTED | ...`), `refs`, `reasons[]`, `timestamp`, `prev_hash`, `hash` (SHA-256 over canonical JSON). The **tape** for a purchase is the ordered set of clips that reference it.

**Binding to PayPal:** `purchase_units[0].custom_id` = the GATE_ALLOW clip hash (64 hex chars, within the 127-char limit).

**Demo-honesty note:** the shopper's signing key is generated in the browser for the demo. Production would use a passkey or device-bound key. Say so in the UI and README.

## 5. PayPal integration map

| Capability | API | Notes |
|---|---|---|
| Save wallet once | Vault v3: setup token → payer approval → payment token | Requires Vault enabled on the sandbox business account. `usage_type: MERCHANT`. |
| Charge without shopper present | Orders v2 with the vault payment token | `custom_id` = receipt hash; `PayPal-Request-Id` on every POST |
| Shipment tracking | Shipment tracking API (Agent Toolkit `create_shipment_tracking`) | Keeps charges eligible for Seller Protection |
| Dispute intake | Webhooks `CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED` | Verify signature first |
| Dispute detail | `GET /v1/customer/disputes/{id}` | Reason, stage, seller response due date, HATEOAS links |
| Inquiry-stage message | `POST .../send-message` | Only while `dispute_life_cycle_stage` is `INQUIRY` |
| Submit evidence | `POST .../provide-evidence` (multipart, `evidence-file`) | Only in `WAITING_FOR_SELLER_RESPONSE` |
| Concede | `POST .../accept-claim`, or `make-offer` (INQUIRY only) | Honesty path |
| Sandbox lifecycle | `POST .../require-evidence` (`SELLER_EVIDENCE`), `POST .../adjudicate` (`SELLER_FAVOR` / `BUYER_FAVOR`) | **Sandbox only.** Lets the demo end with PayPal settling on camera |
| Create test dispute | `POST /v1/customer/disputes` | Limited-release; enable Disputes in app features. Fallback: sandbox buyer opens it in the PayPal UI |
| Merchant ops agent | `@paypal/agent-toolkit` | list/get disputes, refunds, tracking |

Dispute reasons to handle: `UNAUTHORISED`, `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`, `CANCELED_RECURRING_BILLING`, `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`, `INCORRECT_AMOUNT`, `DUPLICATE_TRANSACTION`, others → generic playbook.

## 6. AI components

| Component | Claude does | Claude never does |
|---|---|---|
| Intent compiler | Turns plain English into a draft IntentMandate + prompt playback | Sign, finalize, or widen anything without shopper approval |
| Shopping agent | Browses fixture pages, picks items, proposes a cart | Pay directly; it only calls the gated checkout |
| Dispute analyst | Reads the verified tape + dispute + buyer message (as untrusted data); drafts the response where every factual sentence cites a clip field | Decide contest vs. concede (deterministic triage does) or submit without Sam's approval |
| Merchant ops agent | Answers Sam's questions, runs toolkit actions he confirms | Take irreversible actions unconfirmed |

Draft validation: every factual sentence must reference a clip ID/field; a deterministic checker rejects drafts with uncited or mismatched claims and asks for a redraft.

## 7. Dispute playbooks

**Deterministic triage first:**
- Charge violated the mandate (after revocation, over cap, wrong SKU/merchant, expired) → **recommend refund** (accept-claim, or make-offer at INQUIRY). Claude drafts a courteous note.
- Chain fails verification → flag for manual review; never contest on broken evidence.
- Otherwise → contest with the playbook below.

**Inquiry first:** while the dispute is in `INQUIRY`, send the shopper their own readback in plain language ("On Oct 14 you authorized your agent to reorder…, approved via PayPal; you were notified Nov 12 at 9:02 AM"), plus a link to manage or cancel the mandate. Goal: resolve before it becomes a claim, a fee, or a ratio hit.

| Reason | Evidence assembled from the tape |
|---|---|
| UNAUTHORISED | Verified IntentMandate signature; PayPal vault approval binding (same customer); prior undisputed charges under this mandate; pre-charge notice timestamps; shipment tracking to the address on the transaction |
| NOT_AS_DESCRIBED | Mandate SKU = cart SKU = shipped SKU; product listing snapshot hash at purchase time |
| CANCELED_RECURRING_BILLING | Mandate active and unrevoked at charge time (revocation log); notice sent |
| NOT_RECEIVED | Tracking and delivery confirmation |
| INCORRECT_AMOUNT / DUPLICATE | Cart total = capture amount; per-period cap ledger; idempotency records |

The evidence file is a generated PDF of the tape plus a JSON appendix with the VCs and public keys so anyone can re-verify offline.

## 8. Day-one sandbox spike (go/no-go)

Write each as a script in `scripts/spike/` and record results in `docs/decisions/0001-sandbox-spike.md`.

1. **OAuth + Orders:** create and capture an order with `custom_id`; confirm `custom_id` round-trips on GET. *(Must pass.)*
2. **Vault:** create setup token, approve as sandbox buyer, exchange for payment token, then charge it with no buyer present. *Fallback:* human-present mode (buyer approves each purchase; AP2 Cart Mandate path).
3. **Disputes:** create a dispute via API on a captured payment. *Fallback:* sandbox buyer opens it in the PayPal UI.
4. **Dispute lifecycle:** `require-evidence` → `provide-evidence` (multipart PDF) → `adjudicate SELLER_FAVOR`. Confirm the stage/status transitions.
5. **Webhooks:** receive and verify `CUSTOMER.DISPUTE.CREATED` locally (tunnel) or on an early Render deploy.
6. **Inquiry message:** `send-message` on an INQUIRY-stage dispute.

## 9. Milestones

**Week 1 — Oct 14–20: Spike + mandates core**
- Spike complete, decisions recorded.
- `packages/mandates`: zod schemas (IntentMandate, CartMandate, PaymentMandate, Clip), VC-JWT sign/verify, policy gate, hash-chained ledger, canonical JSON. Tests for every gate rule and every tamper case.
- Monorepo, lint, typecheck, CI (GitHub Actions: typecheck + test).
- `docs/LEARNING.md` started.

**Week 2 — Oct 21–27: Shopper → agent → checkout**
- Shopper flow: compile → readback → PayPal vault approval → sign → manage/revoke.
- Reference agent + catalog fixtures + attack fixtures (hidden instructions, fake system text, price swap, SKU swap, merchant redirect, quantity bump).
- Gate API end to end: allow → cart mandate → charge vault token → capture → tracking; deny → clip.
- Pre-charge notice + one-tap cancel.
- Oct 27: listen to PayPal Q3 earnings; note any agentic/identity language for the pitch.
- **Fable security review** of mandates + gate.

**Week 3 — Oct 28–Nov 3: Disputes + dashboard + deploy**
- Webhook receiver; dispute pipeline: triage, inquiry message, playbooks, evidence PDF, provide-evidence, sandbox adjudicate.
- Merchant dashboard; move to AG Studio once the trial starts (~Oct 31): custom Tape widget, deadline countdowns, fees/ratio widgets, Studio Agent Framework queries.
- Deploy to Render; demo reset script.
- Upstream PR to `paypal/agent-toolkit` adding a `provide_dispute_evidence` tool (TypeScript), following that repo's contribution conventions.

**Week 4 — Nov 4–10: Proof + polish + story**
- Run evals; publish numbers in README.
- README, ARCHITECTURE.md, accessibility pass, empty/error states.
- Record and edit the video. Devpost text.
- **Fable pre-submission audit** Nov 9–10.

**Nov 11:** tag `v1.0-submission`, submit. **Nov 12 noon PT:** hard deadline.

## 10. Evaluation (`evals/`)

~30 scripted scenarios with labeled expected outcomes:
- 10 legitimate in-mandate purchases (vary dates, prices within cap)
- 6 injection/attack pages (listed in Week 2)
- 4 mandate violations (expired, revoked, over cap, wrong SKU)
- 10 disputes across reasons, including 3 where the merchant should lose

Report: gate decision accuracy (target 100%), injection attempts blocked, triage accuracy vs. labels, wrongful-contest rate (target 0), citation validity rate, median time from dispute webhook to draft ready.

## 11. Demo video (under 3:00)

- **0:00–0:12 Hook.** "Pilots read every instruction back before they act, and it's all on tape. When your AI agent spends your money, who proves what you said?"
- **0:12–0:45 Delegate.** Maya types the instruction; Claude reads it back; she approves in PayPal; the recording indicator turns on.
- **0:45–1:05 Buy.** The agent reorders; the gate allows; the clip is recorded; `custom_id` shown on the PayPal order.
- **1:05–1:25 Attack.** An injected "premium bundle" page tries to upsell the agent; the gate denies it with reasons.
- **1:25–2:20 Dispute.** Month three, "I didn't authorize this." Inquiry message with Maya's own readback; escalation; **roll the tape**; Claude's cited draft; Sam approves; evidence submitted; PayPal sandbox settles in the merchant's favor.
- **2:20–2:40 Honesty.** A charge that slipped through after revocation: Readback recommends the refund.
- **2:40–2:55 Proof.** Dashboard numbers from evals; open-source library; upstream PR to PayPal's Agent Toolkit.
- **2:55–3:00 Close.** "Readback. Every purchase your AI agent makes, on the record."

Royalty-free music only. No third-party logos used as our branding.

## 12. README structure (judge-facing)

1. One-line pitch + 30-second GIF
2. The problem (with sources)
3. How it works (diagram)
4. **Technological Implementation**: PayPal APIs used and how; Claude's role; the design principle
5. **Design**: the three user flows with screenshots
6. **Potential Impact**: who it's for, numbers from evals, fees/ratio math
7. **Innovation**: AP2 human-not-present mandates on PayPal rails; dispute loop; upstream contribution
8. **Run it**: hosted URL; one-command local setup; sandbox test accounts are in the Devpost testing instructions, not the repo
9. Honest limitations (demo keys, sandbox-only endpoints used, what's simulated)
10. License, contributing, acknowledgements

## 13. Submission checklist

- [ ] Public repo, Apache-2.0 license visible in the repo's About section
- [ ] Hosted demo on Render, kept live through Dec 15, 2026
- [ ] Setup instructions verified from a clean clone
- [ ] Sandbox test credentials in Devpost testing instructions (never in the repo)
- [ ] Video under 3:00, public on YouTube, royalty-free audio, shows the real app working
- [ ] Devpost text lists every AI tool and how it's used
- [ ] Tag `v1.0-submission`; Devpost points at the tag
- [ ] Re-read the Official Rules for amendments a week before submitting

## 14. Non-goals

General-purpose shopping agent; browser automation; crypto/stablecoins; full DID/issuer infrastructure; real money; multi-merchant marketplace; mobile apps.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Vault charging without buyer present fails in sandbox | Human-present fallback (Cart Mandate per purchase); story still holds |
| API dispute creation is limited-release | Sandbox buyer opens disputes in the UI; sandbox lifecycle endpoints still apply |
| AG Studio trial expires before judging | Start ~Oct 31; ask AG Grid in Discord for a hackathon extension |
| TypeScript learning curve | Teaching mode; simple patterns; LEARNING.md |
| Scope creep | This spec's non-goals; Dante approves any additions |

## 16. References

- PayPal AI Hackathon: Official Rules, Resources, AG Grid and Render sponsor pages (paypalaihackathon.devpost.com)
- AP2 specification: ap2-protocol.org/specification
- PayPal Disputes API: developer.paypal.com/api/customer-disputes/v1
- PayPal Vault (save payment methods): developer.paypal.com/api/save-with-purchase/save-payment-methods
- PayPal Agent Toolkit: github.com/paypal/agent-toolkit
- PayPal AI Toolkit plugin: github.com/paypal/AI-Toolkit
- PayPal AG Grid boilerplate: github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate
- PayPal UK Agentic Commerce Pulse (Apr 2026): paypalobjects.com
- PayPal Seller Protection policy: paypal.com/us/security/seller-protection
