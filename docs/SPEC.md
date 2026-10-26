# Readback — Product Spec

*The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.*

Companion to `CLAUDE.md`. This file is the source of truth for what we build, the demo, and the schedule. Companion documents:
- `docs/WHY-PAYPAL.md`: the sourced case for PayPal (problem, law, market, competition, hard questions).
- `docs/THREAT-MODEL.md`: what can go wrong and what stops it.
- `docs/PROPOSAL-agent-terms.md`: the one API change that would make this native to PayPal.

Research current as of Oct 14, 2026. This revision incorporates an independent security audit, two mock judging-panel reviews, and a fact check. Facts marked **[spike]** are confirmed or corrected in the first days of the sandbox spike (§8).

---

## 0. The idea in one paragraph

**Maya tells her AI once what it may buy. PayPal holds that promise, her agent signs every purchase, and when anyone says "my AI bought that," the truth takes one click.**

- **Consent.** Maya approves her agent's terms on PayPal's own approval page, which shows a summary carrying her agent's key fingerprint. PayPal stores the exact terms (merchant, item, cap, cadence, dates, fingerprint), and nobody can edit them afterward. PayPal doesn't keep the summary she saw (spike step 2), so the key binding rests on an honest setup and her fingerprint comparison (T21); seller-favor suggestions therefore also require history (check 11).
- **The agent.** Her assistant (Claude, or any MCP-capable assistant) is the brain. It holds no keys and has no way to pay. A small **agent runtime** on Maya's side holds the agent's private key (P-256), checks each request against her terms, and signs an **AP2-style closed mandate**.
- **Purchases.** Each purchase is a PayPal order charged under the agreement. It carries:
  - the signed mandate;
  - a copy of the terms;
  - references binding the order to both;
  - an invoice ID naming its billing period, so PayPal itself refuses a second charge in that period.
- **Disputes.** Readback rebuilds the case from PayPal's records and runs eleven checks, including the agent's signature against the key Maya approved. It suggests an outcome only when the evidence supports one.

**The moment judges should remember: same claim, two verdicts.**
- A signed, in-terms purchase that Maya disowns: **seller's favor**.
- A charge the merchant made itself, with no request from her agent: **buyer's favor**, against the merchant running Readback.

**Principles.**
- LLMs propose; cryptography and deterministic checks decide.
- Readback stores nothing; PayPal is the only system of record.

**"Stores nothing," precisely.**
- **Never:** a database; runtime writes to disk; data that outlives a request; caches or queues.
- **Allowed:**
  - configuration in environment variables (secrets, seeded demo IDs);
  - read-only fixtures bundled in the repo;
  - client-held identifiers (Maya's agreement ID in her URL or cookie, and in her runtime's config);
  - in judge mode, a key held only in the judge's open browser tab (§5.7);
  - ephemeral per-instance rate-limit counters;
  - per-request computation.

## 1. Problem

Full sourcing in `docs/WHY-PAYPAL.md`. The essentials:

- **Shoppers want agents but fear them.** In Commerce and PayPal research (June 2026), most shoppers were interested in agentic shopping. The top UK worry was an AI buying without approval, and purchase confirmation was the most important feature across markets.
- **PayPal reviews the transaction, not the agent.** PayPal says it evaluates claims on the transaction itself and does not assess AI intent or behavior. When an agent acts without the account holder's authorization, the claim is typically reviewed as an unauthorized payment. Nothing in that review records what the shopper delegated, or to which agent.
- **The law turns on facts that usually aren't recorded.**
  - **US.** Under Reg E, the questions are what authority the consumer gave and when they told PayPal to stop (§1005.2(m), comment 2(m)-2).
  - **UK.** The Financial Ombudsman has ruled against PayPal where a billing agreement existed but PayPal couldn't show the dates and amounts agreed.
  - **The Fed.** A Federal Reserve Governor said in September 2026 that the question shifts from proving a buyer is an authorized payer to proving that an agent has the authority to pay.
- **We found no network dispute rule for agent purchases**: no liability shift and no agent-specific reason code.
- **Merchants want rules, not insurance.**
  - In PayPal's UK research, almost two-thirds of merchants say they need agreed rules similar to card dispute rules.
  - Among large US enterprises, only 3% think the payment provider should be liable for agent disputes.
- **PayPal carries the cost when it's eligible.** PayPal covers an eligible Seller Protection claim. Its protection-program allowance recorded $1,487M in realized losses and charge-offs in 2025, up 22%. That is about 8.3 bps of TPV gross, across all programs, not only this claim type.

**What exists, and the gap:**
- **Agent Ready** extends PayPal's protection programs to agent transactions.
- **PayPal's WebMCP support** (Sept 2026) hands the buyer to PayPal to approve each purchase. That is a human-present flow.
- **AP2 v0.2** (contributed to FIDO) and **Mastercard Verifiable Intent** define signed records of what a user authorized. Both need new credentials and adoption, and neither is confirmed live in dispute flows.
- **Merchant-side tools** argue the merchant's case: Chargebacks911, Chargeflow, Justt, and another entry in this hackathon.

**The gap.** Readback is the **human-not-present** complement: approve once, within limits, and have every purchase checked against that approval. It runs AP2's autonomous model on PayPal's existing rails, then decides disputes for whichever side is right. **Agent Ready lets agents pay. Readback lets PayPal prove what they were allowed to pay for, and which agent asked.**

**Do not claim** Readback is:
- the first to record user authorization or to sign agent mandates (AP2 and Verifiable Intent do this);
- the first to use purchase history as evidence (that's Visa CE 3.0);
- the first to draft disputes with AI.

### 1.1 Who adopts it
- **Shoppers** get a hard limit their agent can't exceed, a receipt that shows what they agreed to, and a merchant who can't charge in their agent's name without a signature by the key bound at setup (an honest setup is the precondition, T21).
- **Merchants** adopt it because it wins the disputes they should win. It's believed because it recommends refunds for the ones they should lose. Integrating it is about 10 lines on top of an existing PayPal integration (§5.8).
- **PayPal** is the natural long-term owner. One API addition, in `docs/PROPOSAL-agent-terms.md`, makes the key binding PayPal-attested and closes the remaining gaps.
- **Agents** only need to speak MCP; the runtime does the rest.

## 2. Users and story

- **Shopper: Maya.** She asks her assistant to keep her dog Biscuit's food stocked. **She is the hero of the story.**
- **Merchant: Sam**, owner of *Good Boy Provisions* (fictional), a small online pet supply shop.
- **Investigator:** a PayPal claims investigator working a queue of agent-purchase disputes.
- **Why replenishment:** standing orders are where people already accept automatic charges. In Global Payments research (Sept 2026), 69% of consumers would let an agent spend up to $100 on groceries and essentials.

**Story mandate:** "Reorder Biscuit's Salmon & Rice Adult (24 lb) from Good Boy Provisions, one bag per 30 days, up to $65 per order, through March 31, 2027, by my agent only."

**Demo cadence.** With 30-day periods, only one period would exist before the deadline. Live demo agreements therefore use a **1-day period**, labeled on screen "demo cadence: 1 day = 1 month."
- **The first seed agreement starts by Oct 21.**
- **Why that date:** the `SELLER_FAVOR` hero case needs 2 or more prior undisputed captures, the earliest at least 7 days before it, before recording on Nov 8.
- **Format freeze, Oct 20:** terms grammar v1, mandate v1, `custom_id`, and `invoice_id` are frozen. Later changes must stay backward-compatible with seed charges.
- **How seed charges are made before the gate exists:**
  - Mandates are signed by `apps/agent` with its env key.
  - A **separate** merchant-side script (`pnpm seed:charge`) submits them. This is a labeled pre-gate exception, so the signer and the charger are still different processes with different secrets.
  - Once the gate is live (about Oct 26), seed charges go through it.
  - **Dante runs `pnpm seed:charge` on Oct 21, Oct 23, and Oct 28 at minimum**, then daily from Nov 1 as needed. Any charge after Oct 28 can then be a hero case.

## 3. Where every fact lives (all in PayPal)

| Fact | PayPal object | Field(s) | Editable by merchant later? |
|---|---|---|---|
| The terms the shopper approved, including her agent's key fingerprint | Payment token (Vault v3) | `payment_source.paypal.description` (≤128): the canonical terms string, shown to the payer at approval | **No** (Vault v3 has no update operation) |
| Agreement type | Payment token | `usage_pattern: RECURRING_PREPAID` (PayPal refuses a `billing_plan` with `UNSCHEDULED_PREPAID`; spike step 2), `usage_type: MERCHANT`, `customer_type: CONSUMER`, `permit_multiple_payment_tokens: true` | No |
| Who approved | Payment token | `payer_id`, `email_address`, `customer.id` | No |
| Terms shown on PayPal's approval page | Setup token request | `billing_plan.name` only, prefixed "to <brand>:" (display only; merchant-supplied; **not returned** on GET). The stored `description` is never shown to the buyer (spike step 2) | n/a |
| Which agreement a charge used | Order | PayPal's `payment_source.paypal.attributes.vault.id` if present; **the sandbox never sends it** (spike step 3). Otherwise the agreement the labels (`custom_id`, `invoice_id`) name, accepted only with PayPal's payer match (check 2a). The payer match shows the agreement belongs to the payer charged, not that this agreement (rather than another of hers with the same merchant) paid, so the link is partly merchant-asserted; it can count for the merchant only together with her agent's signature for that same agreement. `stored_credential` is merchant-declared, shown but never decisive | No |
| The agent's signed request | Order | `purchase_units[0].items[0].description` (≤2048 retained): the compact JWS | Merchant writes it, but can't forge it without the agent's private key |
| Each charge | Order and capture | amounts and `amount.breakdown`; `items[]` (`name`, `sku`, `quantity`, `unit_amount`); `invoice_id`; `custom_id`; `purchase_units[0].description` | Merchant sets labels; PayPal records amounts, payer, time, and payment source |
| One charge per period | Order | Canonical `invoice_id = RB-<tokenId>-P<NNN>`; PayPal rejects duplicates (`DUPLICATE_INVOICE_ID`) by default | — |
| Agreement active at charge time | The charge itself | PayPal refuses charges on cancelled agreements (`AGREEMENT_ALREADY_CANCELLED` at authorize/capture, `INVALID_VAULT_ID`) | No |
| Revocation | Token deleted (by shopper or merchant) | GET token → 404 **[spike]**; `VAULT.PAYMENT-TOKEN.DELETED` webhook; buyer-side cancel behavior **[spike]** | — |
| Seller Protection status | Capture | `seller_protection.status`, `dispute_categories` | No |
| Delivery | Order trackers | `POST /v2/checkout/orders/{id}/track`; read back in GET order `purchase_units[].shipping.trackers[]` | Merchant-reported |
| History | Transaction Search | `transaction_info.custom_field`, `invoice_id` (filter client-side; ≤31-day windows; up to 3-hour lag) | No |
| The dispute | Disputes v1 | `reason`, `dispute_life_cycle_stage`, `status`, `disputed_transactions[].seller_transaction_id`, `custom`, `invoice_number`, `evidences[]` | No |
| Evidence | Disputes v1 `provide-evidence` | multipart: `input` JSON + `evidence-file` (pdf/png/jpg/gif, <10 MB each, ≤50 MB) **[spike: part names]** | — |

## 4. Readback's formats

Everything is plain ASCII and validated with zod in `packages/readback-core`. Every limit is enforced, and every component fails closed if anything doesn't fit.

### 4.1 Terms string
- **Length:** at most 127 characters. The worst case under the limits below is 125.
- **Where it goes:** the token's `description` at approval, **and** every order's `purchase_units[0].description`.
- **Example (107 characters):**
```
RB1 Good Boy Provisions | GBP-SR24 x1/30d | max USD 65.00 | 2026-10-14..2027-03-31 | agent qX7mP2vL9cRt4sYb
```

| Field | Rule |
|---|---|
| Merchant name | ≤24 characters, from `[A-Za-z0-9 &'.,-]` |
| SKU | ≤16 characters, from `[A-Z0-9-]` |
| Quantity | ≤999. `x2/30d` means one order of up to 2 per period, not two orders |
| Period | 1–999 days |
| Cap | Per order, USD only, at most 9999.99 |
| Dates | Start begins at 00:00:00 UTC; end is inclusive through 23:59:59.999 UTC |
| Agent fingerprint | The first 16 characters (96 bits) of the base64url RFC 7638 thumbprint of the agent's P-256 public key, compared case-sensitively |

**How the fingerprint is displayed:**
- **In every UI and in the runtime:** grouped 4×4 with spaces and in monospace, as `qX7m P2vL 9cRt 4sYb` (spaces, because `-` and `_` are themselves base64url characters; see ADR 0002).
- **In the stored string:** ungrouped.
- **Never truncate it on screen.** A partial fingerprint can be brute-forced.

### 4.2 termsHash, period, and money
- **termsHash:** SHA-256 of the exact terms string (UTF-8), as lowercase hex.
- **Period index:** `p = floor((iat − startEpochSec) / (period_days × 86400)) + 1`, where `startEpochSec` is 00:00:00 UTC on the start date. The period is fixed at **signing time**.
- **Bound:** the terms parser rejects any agreement where `(end − start) / period_days > 999`, so `p` always fits three digits.
- **Money:** parse amounts with `^\d{1,4}\.\d{2}$` into integer cents, and compare integers only. Never compare money as strings.

### 4.3 Closed mandate (agent-signed, one per purchase)
A compact JWS (RFC 7515) using **ES256 over P-256** (RFC 7518), because AP2 v0.2's JWK schema requires EC P-256 keys for `cnf`. It is stored in the order's `items[0].description`.
```
header:  { "alg": "ES256", "typ": "rb-mandate+jwt",
           "jwk": { "kty": "EC", "crv": "P-256", "x": "<…>", "y": "<…>" } }
payload: { "v": 1, "agr": "<tokenId>", "th": "<termsHash first 16 hex>",
           "sku": "GBP-SR24", "qty": 1, "unit": "64.99", "amt": "64.99", "cur": "USD",
           "p": 3, "iat": <unix>, "exp": <iat + 300>, "jti": "<random>" }
```

**Hygiene, enforced in `readback-core`:**
- Accept exactly `alg: ES256` and `typ: rb-mandate+jwt`, and pin `algorithms: ['ES256']`.
- The header `jwk` must be exactly `{kty, crv, x, y}`. Reject `d`, `kid`, `jku`, `x5u`, `x5c`, `crit`, `b64`, and any other header member.
- Before parsing, the JWS must match `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`.
- `amt` must equal `unit × qty` exactly, and binds the order's total `amount.value`. Shipping, tax, handling, insurance, and discount must be zero.

**Size:** about 570 characters typical, 622 worst case, well under the 2,048 retained.

**Valid** only if all of these hold:
- the signature verifies with the embedded key;
- that key's thumbprint prefix equals the fingerprint in the approved terms;
- every payload field matches the order and the terms.

**mandateHash:** SHA-256 of the compact JWS string exactly as returned by GET order, as lowercase hex. **It is an index, not a security control.** It powers duplicate-mandate detection (the `custom_id` label). Idempotency uses **requestHash** instead: SHA-256 of the signed content (`header.payload`), which is the same for both valid encodings of one ECDSA signature (audit Oct 25).

### 4.4 invoice_id and custom_id
**invoice_id** (canonical, ≤127, visible to the payer). NNN is the zero-padded `p`:
```
RB-<tokenId>-P003
```

**custom_id** (≤79 worst case, assuming tokenId matches `^[0-9A-Za-z_-]{1,36}$`, which is enforced, fail closed **[spike: real token lengths]**; `:`-separated, because Transaction Search's `custom_field` excludes `|`):
```
rb1:<tokenId>:<termsHash first 16 hex>:p003:<mandateHash first 16 hex>
```

### 4.5 billing_plan (display only)
Sent on the setup token so PayPal's approval page shows the plan. The page shows only `name`, prefixed "to <brand_name>:" (spike step 2).
- `name`: at most 127 characters; letters, digits, spaces, and `() + ' , . : -` only (PayPal rejects `_`). Format: `GBP-SR24, up to 1 per order every 30 days, max USD 65.00 each, until 2027-03-31, agent qX7m P2vL 9cRt 4sYb`. The merchant isn't repeated, since PayPal adds the brand. Agent keys are generated until the fingerprint contains no `_`.
- One REGULAR cycle, with VARIABLE pricing at the cap, a frequency matching the period, and `start_date` = the terms' start (without it PayPal wants a first payment now).
- The required `one_time_charges.total_amount: 0.00`.
- Accepted only with `usage_pattern: RECURRING_PREPAID` (spike step 2).

The plan name is merchant-supplied and not stored, so it can't prove which fingerprint is in `description` (THREAT-MODEL T21).

### 4.6 AP2 alignment (v0.2, autonomous mode)

| AP2 v0.2 | Readback on PayPal |
|---|---|
| Trusted Surface where the user authorizes open mandates | PayPal's approval page |
| Open mandate constraints, with the agent key as `cnf` (EC P-256) | The terms string, with the P-256 key fingerprint |
| Credential Provider | PayPal |
| Agent-signed closed mandate | The ES256 JWS in each order |
| Closed mandate bound to its open mandate (via `sd_hash`) | `th` in the mandate. Analogous, not identical |
| Receipt `reference` = hash of the closed mandate | `mandateHash` prefix in `custom_id`. Analogous, not identical |
| Constraint evaluation | The runtime's pre-check, the gate, and the investigator checks |

**Differences, stated plainly:**
- **Credential format.** AP2 uses SD-JWT verifiable credentials. Readback uses a compact JWS, and its open mandate is authenticated by PayPal's approval, not by a user signature.
- **Reuse.** AP2 allows one open mandate per checkout and models reuse through `payment.agent_recurrence` and `payment.budget`, which require tracking previous presentations. Readback reuses one approval across periods **statelessly**, because PayPal's invoice uniqueness enforces one purchase per period.

**AP2 import (core; replaces the exporter).** `readback-core` reads a real AP2 v0.2 open Payment Mandate and runs the same constraint checks against a proposed purchase.
- **Mapping:**
  - `payment.amount_range.max` (integer cents) maps to the cap;
  - `payment.allowed_payees` maps to the merchant;
  - `payment.execution_date` maps to the dates;
  - `payment.agent_recurrence.frequency` maps to the cadence, with `MONTHLY` ≈ 30 days, labeled approximate;
  - the `cnf` P-256 key maps to the agent key.
- **Fixture:** built from the AP2 repo at v0.2.0: `code/sdk/python/ap2/tests/agent_recurrence_tests.py` and the decoded example in `docs/ap2/payment_mandate.md`.
- **Display:** shown side by side with the PayPal-native case in the investigator view's "AP2" tab.
- **The pitch:** an AP2 mandate, enforced and adjudicated on PayPal rails that exist today.

### 4.7 Action proofs (revoke and direct-charge)
A compact JWS that proves the caller holds the agreement's agent key, for two routes: `DELETE /api/agreements/[tokenId]` and `POST /api/demo/direct-charge`.

```
header:  { "alg": "ES256", "typ": "rb-action+jwt", "jwk": { "kty": "EC", "crv": "P-256", "x": "<…>", "y": "<…>" } }
payload: { "tokenId": "<tokenId>", "purpose": "revoke" | "direct-charge", "iat": <unix> }
```

**Rules:**
- The same hygiene rules as §4.3 apply: exact header members, pinned `ES256`.
- The payload has exactly these three members.
- `iat` must be within ±60 seconds of now.
- `purpose` must match the route.
- The key's thumbprint prefix must equal the fingerprint in the token's terms.

**Evals:** wrong key, wrong purpose, and stale `iat`.

## 5. Product surfaces

**One design system for every surface.**
- One set of design tokens (color, type scale, spacing) feeds both the Next.js pages and the AG Studio theme.
- **The four-light component** (Consent · Agent · Terms · Delivery) appears identically in Maya's agent card, the queue, and the case view. Lights carry text labels and screen-reader names; color is never the only signal.
- **Every denial and error has a designed, plain-language state.** For example: "Refused: your agreement allows one bag per period, and one was already ordered on Nov 3."
- Use the `frontend-design` skill for direction.

### 5.1 Maya: delegate once (`apps/web/app/shopper`)
1. **Instruction.** Maya types it. Claude compiles it into draft terms and shows the **readback**: a plain-language card ("Your agent may buy: 1 bag of Salmon & Rice, once a month, up to $65, until Mar 31").
2. **Fingerprint step.** The page does **not** display the fingerprint. It tells Maya her agent will show its fingerprint, and that she should check PayPal shows the same one. That comparison is the only independent defense against a merchant swapping in its own key (THREAT-MODEL T21).
3. **Setup token.** Readback gets the runtime's public key from `/.well-known/agent-key`. It builds the terms and creates the setup token: the terms in `description`, the plan in `billing_plan`, and `permit_multiple_payment_tokens: true`.
4. **PayPal approval.** Maya approves on PayPal's page. Readback exchanges the setup token for the payment token (the open mandate). Its ID goes into her URL and cookie (client-held). Her assistant passes it to the runtime on each call (§5.2).

### 5.2 Maya's agent: any MCP assistant plus the agent runtime (`apps/agent`, separate service)
**The brain is Maya's assistant.**
- In the demo, that's her Claude app, using a custom connector to a remote MCP server. Custom connectors work on every Claude plan.
- MCP is an open protocol, so any MCP-capable client can drive the same tools. The README lists only clients we actually tested.
- The **MCP Inspector** (the protocol's open-source developer tool) is shown driving the same runtime, to prove it's protocol-level.

**The runtime** uses `@modelcontextprotocol/server` v2 (`createMcpHandler`, streamable HTTP, nothing held between requests). It holds **the agent's P-256 private key** in an environment variable and **no PayPal credentials**.

**Which agreement.** Every tool takes an `agreement` argument (a token ID, client-held), passed on every call. On each call the runtime fetches the terms through §5.3a and **refuses unless they contain its own fingerprint**. It stores nothing.
- **Two secret MCP paths, two agreements.** Token IDs appear on public pages (the queue and the case tape), so secrecy of IDs is not the control; the path is.
  - **Dante's path** (`/mcp/<heroSecret>`) accepts only `HERO_AGREEMENT_ID` (env). Only it can act on the hero seed agreement.
  - **The judge path** (`/mcp/<judgeSecret>`, given in the Devpost instructions) accepts only `JUDGE_AGREEMENT_ID` (env), a dedicated agreement under the runtime key. It **does not expose `revoke_agreement`**. The judge-mode chat panel uses this path.
  - **Revoke:** the runtime refuses it for `JUDGE_AGREEMENT_ID` on any path.
- **Judge's own agreements:** these carry the judge's browser-key fingerprint, so the runtime correctly refuses them. Judges sign those purchases in the browser (§5.7).

**Its MCP tools:**
- `my_agent_card({agreement})`: the consumer moment. It returns a rendered summary:
  - what this agent may buy;
  - what it has bought, with dates, amounts, and links to the PayPal receipts;
  - the agent's fingerprint (grouped), with "Check that PayPal shows the same";
  - how to cancel: a link to PayPal's automatic-payments settings, or asking the agent to revoke (`revoke_agreement`).

  Data comes via the merchant's agreement endpoint (§5.3a) and is labeled as merchant-relayed. It detects misconfiguration, not a dishonest merchant.
- `browse_catalog({query})`: returns catalog fixtures, including attack pages, wrapped as **untrusted data**.
- `revoke_agreement({agreement})`: signs a revoke request with the agent key and calls `DELETE /api/agreements/[tokenId]`.
- `request_reorder({agreement, sku, quantity})`: runs `readback-core`'s constraint check and refuses anything outside the terms, with a plain-language reason. Otherwise it signs the closed mandate and posts it to the gate.

**Public endpoint:** `GET /.well-known/agent-key` returns the public JWK and fingerprint.

**Defense in depth.** A prompt-injected assistant can ask for the wrong thing, but the runtime won't sign it and the gate won't charge it.

**Access (demo-grade):** an unguessable secret path in the connector URL, labeled demo-grade. Production would use OAuth (THREAT-MODEL T20).

**Scripted harness** (`apps/agent/harness`): drives the same tools with the Anthropic SDK for the evals and attack fixtures.

### 5.3 Checkout gate (`apps/web/app/api/checkout`, stateless, fails closed)
1. **Receive** the compact JWS. Before any PayPal call:
   - run the hygiene rules;
   - verify ES256 with the embedded key;
   - check that `iat ≤ now + 60s` and `now + 60s ≤ exp` (the gate stops one clock skew before `exp`, so PayPal's capture time still lands inside check 3's window; T27).
2. **GET** the payment token named in `agr`. A 404 or error means **deny: agreement not active**.
3. **Parse** `description` into terms. Check that the key's thumbprint prefix equals the terms fingerprint, and that `th` equals termsHash.
4. **Check deterministically:**
   - the merchant is this merchant;
   - the SKU matches;
   - quantity ≤ the per-period quantity;
   - `unit × qty = amt` ≤ cap (integer cents);
   - the time is within the dates;
   - `p` equals period(`iat`).
5. **Compute** the canonical `invoice_id`, `custom_id`, and `mandateHash`.
6. **Create the order:**
   - `payment_source.paypal.vault_id` and `stored_credential {payment_initiator: MERCHANT, usage: SUBSEQUENT, usage_pattern}`;
   - `amount.value = amt`, with `breakdown.item_total = amt`;
   - `items[0] = {name, sku, quantity, unit_amount, description: JWS}`;
   - the description set to the terms string, plus `invoice_id` and `custom_id`.

   **Idempotency:** `PayPal-Request-Id = rb-<first 40 hex of requestHash>`, where `requestHash` is the SHA-256 of the mandate's signed content (`header.payload`), with derived IDs for capture and track. ECDSA lets anyone holding a JWS re-encode its signature; hashing the signed content keeps both encodings one request (audit Oct 25). `custom_id` still carries `mandateHash16` (frozen format). Capture if not auto-completed **[spike]**.

   PayPal errors map to plain-language denials:
   - `DUPLICATE_INVOICE_ID` → "already ordered this period (refused by PayPal)."
   - `INVALID_VAULT_ID`, `AGREEMENT_ALREADY_CANCELLED`, or `PERMISSION_DENIED` (what the sandbox returns for a deleted token; spike step 5) → "agreement not active."
   - A failed capture is a denial; the order is left uncaptured.
7. **Track:** add the tracker when Sam ships (`/v2/checkout/orders/{id}/track`, `notify_payer: true`).
8. **Rate limiting:** delegated to the platform, or kept in ephemeral per-instance counters.

### 5.3a Agreement endpoint (`apps/web/app/api/agreements/[tokenId]`)
`GET` returns the token's `description`, status, and recent orders, read live from PayPal.
- **How recent orders are found:** Transaction Search filtered client-side on the `custom_field` prefix `rb1:<tokenId>:` (≤31-day windows, up to 3-hour lag), plus any order IDs the caller passes for fresh charges.
- **What it returns:** dates, amounts, and periods. No personal data.
- **Not evidence:** because it is merchant-served, nothing it returns is ever treated as evidence.

### 5.4 Merchant role (inside the case view; no separate page)
A **Merchant** role toggle in the case view, plus a small header on the queue.

**Auth.** Merchant write actions (send a message, send Readback's evidence, accept the claim with a refund) require `MERCHANT_ADMIN_TOKEN`, an env secret compared server-side. On the public deployment the role is **view-only** without it: drafts and Readback's statement are shown, and the send buttons stay disabled until the token is entered. The server checks the token on every request.

Sam can:
- see his agreements;
- approve Claude's drafts;
- see per-charge Seller Protection status;
- see the dispute ratio against PayPal's high-volume line (a ratio of 1.5% or more, with more than 100 sales).

### 5.5 Dispute pipeline (`apps/web/lib/disputes`, stateless, idempotent)
1. A verified webhook or a poll triggers it.
2. **GET** the dispute. Find the capture by `seller_transaction_id`, then the order (`supplementary_data.related_ids.order_id` **[spike]**), then the token: PayPal's vault echo if present, else the agreement the order's labels name (the sandbox sends no echo; spike step 3). Check 2a accepts a label-named agreement only with PayPal's payer match. `custom` and `invoice_number` on the dispute are cross-checks.
3. Fetch the token (or the secondary terms copy), the trackers, and the history.
4. Run the eleven checks and classify (§5.6).
5. Read `dispute.evidences[]` and `messages[]` before sending, so retries never double-submit.
6. Claude drafts.
7. Sam approves. Nothing is ever auto-sent.
8. Send, from the case view's **Answer PayPal** panel. There are two options:
   - **Send Readback's evidence.** The statement is written by code from the checks (at most 2,000 characters) and sent with `provide-evidence` or `provide-supporting-info`, whichever the links offer. The dispute is then read back to confirm it landed.
   - **Accept the claim with a full refund.** This uses `accept-claim` with `accept_claim_type: REFUND` and a note written by code. PayPal refunds at once and resolves the dispute about two minutes later (spike step 7).

   Nothing is sent for a dispute PayPal has already resolved, or for a charge it shows refunded in full.

### 5.6 Investigator queue and case view
**Framing.** A **proposed workflow** for a PayPal claims investigator, labeled as a concept. In this build the page and its data are served by the merchant's deployment, so results are **re-derivable** by anyone with API access to the merchant's account, but not independent of the deployment. The `@readback/verify` CLI (§5.8) removes the dependence on the merchant's hosted code. It does not remove the need for API access to that account, since PayPal's APIs return only an account's own disputes and captures. Say "re-derivable," never "independent."

**Queue** (`apps/web/app/investigator`, **AG Studio**):
- **Built as** a custom AG Studio widget wrapping AG Grid, themed from the shared design tokens.
- **Columns:** reason, stage, amount, deadline countdown, classification, suggested outcome, failed checks, evidence tier, and source.
- **Custom renderers:** the four-light strip (it expands to the eleven checks) and a signature badge.
- **Studio Agent Framework (core):** investigators ask in plain English, such as "cases the merchant should lose," "failed only on delivery," or "consent unverified." A Studio Agent handler in `apps/web` answers with deterministic filters over computed results. Claude phrases the answers; it never rules.
- **Chart:** one chart of classifications.
- **Rows:** about 15 live sandbox disputes, hand-opened in week 3, plus replayed eval fixtures. Every row is **labeled by source**.
- **Stretch: simulated-volume toggle.** About 2,000 cases generated in the browser from `readback-core`, labeled "Simulated," to show triage at volume.

**Case view** (`/investigator/[id]`):
- **What it accepts:** a dispute ID, **or a capture ID** for "check this charge" preview mode. The route tells them apart by format (dispute IDs start with `PP-D-`).
- **Preview mode** lets judges inspect a charge they just caused without opening a dispute. The gate and the direct-charge responses return the capture ID, and the tab deep-links to `/investigator/<captureId>`.
- **Capture → order:** `GET /v2/payments/captures/{id}`, then `supplementary_data.related_ids.order_id`, then `GET /v2/checkout/orders/{id}` **[spike]**.
- **Case header:** reason, stage, amount, deadline, and the buyer's statement (shown as untrusted text).
- **Tape widget:** agreement (terms + fingerprint) → signed mandate → order → capture → tracker → dispute, each with its PayPal object ID.
- **Tabs:** "Checks" (default), "AP2" (§4.6), and "Merchant" (§5.4).

**Eleven checks** (shown in four groups; check 2 has two parts, 2a and 2b, so the table has twelve rows):

| # | Group | Check | Pass means |
|---|---|---|---|
| 1 | Consent | **Consent on PayPal** | A payment token exists, its `payer_id` matches the order's `payer.payer_id`, and its terms parse. If the token was deleted, the secondary copy from the charges is used and labeled. |
| 2a | Consent | **Agreement link** | PayPal's vault echo (`attributes.vault.id`) if present; otherwise the agreement named by `custom_id` and/or `invoice_id` (labels that name different agreements = no link). A label-named agreement counts only with PayPal's payer match (check 1). If the agreement is gone and there's no echo, the link is secondary, which withholds a seller-favor suggestion only. Rule: merchant-written labels can count against the merchant, never for it; the signature by the approved key for that agreement (check 3) is what can favor the merchant. History entries (check 11) count only with PayPal's payer match plus a mandate signed by the approved key naming this agreement. `stored_credential` is merchant-declared and never decides a check. |
| 2b | Agent | **Labels present** | `custom_id` and `invoice_id` parse and name that token. |
| 3 | Agent | **Requested by her agent** | The JWS passes hygiene and verifies. Its key's thumbprint prefix equals the approved fingerprint. Its payload matches the order (`agr`, SKU, quantity, unit and amount compared as integer cents, `p`). The capture time is within `[iat − 120s, exp + 60s]`: the gate accepts `iat` up to 60 s ahead of its clock and stops 60 s before `exp`, and PayPal's clock may be 60 s off (T27). No other capture under the token carries the same mandateHash. |
| 4 | Consent | **Active at charge** | The capture completed with the saved wallet, which PayPal refuses on cancelled agreements. No deletion event before the capture time, if events are retrievable. |
| 5 | Terms | **Within cap** | `amount.value` (integer cents) ≤ cap, and equals the signed `amt`. |
| 6 | Terms | **Approved item** | Order SKU and quantity match the terms and the signed mandate. |
| 7 | Terms | **One per period** | `invoice_id` byte-equals the canonical `RB-<tokenId>-P<NNN>`, with NNN = period(`iat`) = `p`. While PayPal's duplicate blocking is on, at most one charge exists per period. If blocking is off **[spike]**, this must be the earliest completed capture of its period. |
| 8 | Terms | **Within dates** | `iat` and the capture time fall within the dates. |
| 9 | Terms | **Bound to these terms** | `th` and the termsHash in `custom_id` equal the hash of the token's terms and of the charge's description copy. |
| 10 | Delivery | **Fulfilled (merchant-reported)** | A tracker on the order with status SHIPPED or DELIVERED, and the order's shipping address equals the shipping address on the payment token (approved at setup), when the token has one. |
| 11 | Delivery | **History** | Prior captures under this agreement with no dispute (via `disputed_transaction_id`), fully completed (refunded ones don't count), each verified through PayPal, and their age. History is built from Transaction Search payments only (`T00xx`, not denied), each capture once. **Provisional** while the capture is under 3 hours old. Inspired by Visa CE 3.0, but weaker. |

**Classification** (deterministic; first match wins; every result lists all failed checks). In preview mode (a capture with no dispute), the reason is treated as UNAUTHORISED: rows 1–4 and 11–13 apply, and rows 0 and 5–10 can't match. The view is labeled "if disputed."

| # | Condition | Classification | Suggestion |
|---|---|---|---|
| 0 | Reason is CREDIT_NOT_PROCESSED, PAYMENT_BY_OTHER_MEANS, PROBLEM_WITH_REMITTANCE, or OTHER | Out of scope | None (checks shown) |
| 1 | Check 1 or 2a fails | Not an agent-agreement charge | None |
| 2 | Check 4 fails | Charged after revocation | `BUYER_FAVOR` |
| 3 | Check 2b or 3 fails | No valid agent request | `BUYER_FAVOR` |
| 4 | Any of checks 5–9 fails | Charged outside approved terms | `BUYER_FAVOR` |
| 5 | NOT_RECEIVED and check 10 fails | Non-fulfillment | `BUYER_FAVOR` |
| 6 | NOT_RECEIVED and check 10 passes | Shipment reported (merchant-attested) | None; supply `PROOF_OF_FULFILLMENT` |
| 7 | NOT_AS_DESCRIBED | Item matches the signed and approved SKU; contents unverifiable | None |
| 8 | INCORRECT_AMOUNT | Amount as authorized | `SELLER_FAVOR` |
| 9 | DUPLICATE_TRANSACTION | No other labeled charge in its period | None. Readback sees only labeled charges; PayPal sees every charge to the wallet (audit Oct 25) |
| 10 | CANCELED_RECURRING_BILLING | In terms; the cancellation time isn't readable | None, until PayPal's cancellation record is readable (spike step 5) |
| 11 | UNAUTHORISED and check 10 fails | Authorized by terms; fulfillment not shown | None |
| 12 | UNAUTHORISED and history below threshold | Consent authenticity unverified | None; route to PayPal account review |
| 13 | UNAUTHORISED, all checks pass, threshold met | Signed by her approved agent, within her terms | `SELLER_FAVOR`. Shows the PayPal reason this evidence supports: `NOT_AN_UNAUTHORIZED_TRANSACTION` |

**Modifiers:**
- **Label-dependent parts are provisional.** Check 3's mandateHash-uniqueness part and check 11 read only label-bearing captures from Transaction Search. Both are **provisional** while a capture is under 3 hours old.
- **Secondary terms.** Any `SELLER_FAVOR` that relied on the secondary terms copy is downgraded to **None**, labeled "terms merchant-attested only."
- **Provisional history.** If history is provisional, any `SELLER_FAVOR` that depends on it becomes **None**.

**History threshold** (a stated policy constant): at least 2 prior undisputed captures, the earliest at least 7 days before this one. A valid agent signature does **not** relax it, because whoever approved the agreement chose the key. It guards **every** `SELLER_FAVOR` row, whatever reason the buyer filed under (audit Oct 25): below it, the suggestion becomes None.

**After a sandbox ruling.** The page shows PayPal's own `adjudications[].reason`; sandbox `adjudicate` accepts only the outcome.

**Claude case brief.** Three to five sentences. Every sentence cites a check number or object ID, and a validator rejects anything uncited. Claude explains; it never rules.

**Live rebuild.** The case view streams the case from PayPal and shows each record as it is read: the dispute, the charge, the order with the signed request, her approved terms, and the earlier charges. Then it reruns every check in the browser. Afterwards, "Rebuilt live from N PayPal records in X s, and stored nowhere" keeps that list one click away, as the case's provenance.

**Re-verify.** A button re-fetches everything from PayPal and reruns all checks, including the signature, in the browser with `readback-core`. The time to verify is shown.

### 5.7 Judge mode (`apps/web/app/page.tsx`)
**A guided rail across the top, about 30 seconds per step, each step deep-linked to live state:**
1. Approve.
2. Buy.
3. Dispute.
4. Investigate. A judge's own signed charge has no tracker or history yet, so its expected result is **"no suggestion yet (no history)"**, labeled as such. The rail also links the seeded hero case, which shows `SELLER_FAVOR`.
5. Be dishonest.

**"Be the agent": the judge holds the key.**
- The judge's browser generates a P-256 key with WebCrypto. The private key is **non-extractable** and lives only in that tab's memory; it is never sent anywhere and is gone when the tab closes.
- **The key survives the PayPal approval** because approval opens in a popup (`window.open`). The return route (`/api/agreements/return`) posts the `tokenId` back to the opener with `postMessage`, checking the target origin, and closes the popup. The original tab, and its key, never navigate away.
- The judge approves terms carrying their own fingerprint on the sandbox PayPal page, using a **separate judge sandbox buyer account** from the Devpost instructions. It is never Maya's, so judges can't cancel the hero agreement or disturb the dispute pool.
- Their browser then signs a purchase, and the gate charges it.
- **Why:** this answers "the builder holds both keys, so the signature is theater." It's a labeled **demo affordance** (THREAT-MODEL T31), and it's the one place a private key lives outside the agent runtime.

**"Be a dishonest merchant."**
- A button calls `POST /api/demo/direct-charge`. It charges the judge's own demo agreement through the merchant's credentials with **no mandate, no `custom_id`, and a non-canonical `invoice_id`**.
- The judge then opens the case view in **preview mode** for that capture. The Agent light is red, the classification is "No valid agent request," and the suggestion is `BUYER_FAVOR`.
- **Guardrails (stateless):**
  - Enabled only when `DEMO_MODE=true` against the sandbox base URL; it refuses to start otherwise.
  - **Ownership:** the request carries an action proof (§4.7) with `purpose: "direct-charge"`, signed by the tab's key. The server GETs the token and requires that the terms fingerprint equals that key's thumbprint, and that the terms start date is today (judge agreements always start today).
  - **Requires duplicate blocking:** the route (and `doctor`) refuse to run if duplicate-invoice blocking is off (spike step 4).
  - **One per agreement:** the charge uses `invoice_id = RB-<tokenId>-DIRECT`, so PayPal's duplicate-invoice block refuses a second one permanently, and `PayPal-Request-Id = rb-direct-<tokenId>`.
  - A fixed in-terms amount, no mandate, no `custom_id`, rate-limited (THREAT-MODEL T32).
  - The non-canonical invoice also fails check 2b. Either way, the result is row 3, `BUYER_FAVOR`.

**"Your two verdicts."** As soon as the judge has bought (step 2) or played the dishonest merchant (step 5), judge mode shows their own charges side by side in the same card as the home page pair, each read from PayPal and re-checked in the browser. The signed charge shows no ruling yet (nothing shipped, no history, and Transaction Search lags), labeled as such; the direct charge shows the red Agent light and `BUYER_FAVOR`.

**Disputes are a fixed, hand-opened pool** that can't be recreated by API. Judge mode is **read-only for adjudication**: it shows recorded adjudications, labeled as recorded.

**Reset demo** creates a fresh setup token and approval link, since every agreement needs a human approval on PayPal. Charges are re-signed after approval. Each judge gets a fresh agreement, so periods never collide.

**"Ask Claude to shop": Claude asks, the judge's tab signs.** Step 2 holds a chat panel where Claude is the shopper's assistant and **the judge's own tab is her agent**:
- `POST /api/chat` runs Claude with three tools. `my_agent_card` (the judge's agreement as PayPal holds it) and `browse_catalog` (the store's pages, attack pages included, as untrusted data) run on the server. `request_reorder` **pauses the loop** and returns the request to the browser.
- The tab does what the agent runtime does before signing: it refuses terms that don't carry its own fingerprint (T21) and anything outside them, signs with its non-extractable key, and posts to `/api/checkout`. The outcome (signed and charged, refused to sign, or signed and then refused by the gate or PayPal) is shown by code, not by Claude, and goes back to Claude on the next turn as a delimited `<agent_result>` block.
- So the AI moment and "it's my key" are the same moment, and the chat needs no judge agreement on the server and no MCP secret in the web app. Judges don't need an Anthropic key; all API keys stay server-side. The agent runtime and its judge path stay for MCP clients (the Claude connector, MCP Inspector).

### 5.8 Developer surfaces: the "we need this" layer
- **`@readback/core` on npm.** Typed, browser-safe, zod schemas exported. Versioned, with a changelog.
- **`npx @readback/verify <disputeId|captureId>`.** A CLI pinned to the published core, run with **the merchant account's API credentials (or by PayPal)**. It prints the eleven checks and the classification. It removes the dependence on the merchant's hosted code, but not on API access to that account.
- **PayPal Agent Toolkit PR.** New tools `verify_agent_purchase` and `provide_dispute_evidence`. Today's toolkit can't submit dispute evidence. The PR also fixes the two confirmed `accept_dispute_claim` bugs: the `note` regex, and parameters leaking into the query string. Opened by Nov 6 and linked from the README.
- **README quick-start.** "Add agent-purchase evidence to an existing PayPal integration in 10 lines," with a runnable `examples/existing-paypal-merchant`.

### 5.9 Proof surfaces
- **Public spike record.** `docs/decisions/0001-sandbox-spike.md` holds every request and response (scrubbed) and a screenshot of the PayPal approval page, linked from the README's Tech section.
- **"Judge it yourself."** A button runs the full eval suite on recorded fixtures in the visitor's browser and shows the scoreboard live.
- **"Try to break it."** The attack lab (`evals/lab.ts`) runs eight attacks through the product's real layers in the browser and shows where each one is stopped: agent runtime, checkout gate, PayPal, or investigator. Each attack's stopping layer is a test.
- **CI.** Evals, fast-check tamper fuzzing, and axe-core accessibility checks (zero violations), with badges and results committed under `evals/results/`.
- **Deploy to Render.** A `render.yaml` Blueprint and the steps in `docs/DEPLOY.md`. `doctor` checks the env, the app features, sandbox reachability, and that no secret is in git history. `pnpm smoke <url>` checks a deployment the way a judge meets it: both services, the return URLs, the verdict pair re-checked from its bundles, the fail-closed routes, and the hosted agent holding the key the agreements name.

### 5.10 Route table

Every route is stateless.
- **Public** means callable without a secret, rate-limited.
- **Admin** means `MERCHANT_ADMIN_TOKEN` is required.
- **Demo** means the route runs only with `DEMO_MODE=true` against the sandbox.

**`apps/web`**

| Method | Path | Auth | PayPal calls | Returns |
|---|---|---|---|---|
| POST | `/api/terms/compile` | Public | none (Claude only) | Draft terms plus the plain-language readback card |
| POST | `/api/agreements` | Public; rate-limited | `POST /v3/vault/setup-tokens` | Approval link. The body carries the terms draft and a `flow` of `maya` or `judge`.
- **Maya:** the server fetches only `${AGENT_RUNTIME_URL}/.well-known/agent-key` from env. The body never carries a URL.
- **Judge:** the body carries the tab's public JWK, and the server sets the start date to today (UTC).
- In both cases the server computes the fingerprint and builds the terms |
| GET | `/api/agreements/return` | Public (PayPal return URL) | `POST /v3/vault/payment-tokens` (exchange) | Redirect to the shopper page with `tokenId` in the URL and cookie |
| GET | `/api/agreements/[tokenId]` | Public; rate-limited (T25) | `GET /v3/vault/payment-tokens/{id}`; Transaction Search | Terms, status, recent orders (§5.3a); no personal data |
| DELETE | `/api/agreements/[tokenId]` | Proof of the agreement's agent key: a JWS over `{tokenId, purpose:"revoke", iat}`; or Admin | `DELETE /v3/vault/payment-tokens/{id}` | 204 |
| POST | `/api/checkout` | Public; the signed mandate is the credential | token GET; `POST /v2/checkout/orders`; capture | Capture ID and order ID, or a plain-language denial |
| POST | `/api/demo/direct-charge` | Demo; JWS from the tab key (§5.7) | token GET; `POST /v2/checkout/orders` (no mandate) | Capture ID |
| POST | `/api/orders/[orderId]/track` | Admin | `POST /v2/checkout/orders/{id}/track` | Tracker |
| GET | `/api/queue` | Public; rate-limited (T25) | `GET /v1/customer/disputes` plus per-row case fetches | Queue rows: live disputes plus labeled fixtures |
| GET | `/api/cases/[id]` | Public; rate-limited (T25) | dispute or capture → order → token → trackers → Transaction Search | **Case bundle:** only the fields the checks read, plus the server-side classification. The browser re-verifies from it. With `?stream=1`, the same build as NDJSON: one line per PayPal record as it is read (label, API, ID, status, time), then the bundle and the classification. The case view uses it to show the case being rebuilt |
| POST | `/api/cases/[id]/brief` | Public | none (Claude only) | Cited brief, validated |
| POST | `/api/cases/[id]/draft` | Public (draft only) | none (Claude only) | Cited draft response or inquiry message |
| POST | `/api/cases/[id]/actions` | Admin | Disputes v1 actions, each sent only when the dispute's `links` offer it (spike step 7), after reading `evidences[]`, `supporting_info[]` and `messages[]` and skipping text already there:<br>- `send_evidence`: the case is rebuilt and Readback's statement goes out as `provide-evidence` or `provide-supporting-info`, then is read back.<br>- `refund_buyer`: `accept-claim` (`REFUND`) with a code-written note; nothing if the dispute is resolved or PayPal shows the charge refunded in full.<br>- `send_message`, `accept_claim`, `provide_evidence`, `provide_supporting_info`: with approved text.<br>Readback doesn't send `make-offer` or `escalate`. | What was sent, and whether it's on PayPal's record |
| POST | `/api/studio-agent` | Public | none (deterministic filters over `/api/queue` results; Claude phrases them) | Answer plus a filter spec |
| POST | `/api/chat` | Public; rate-limited; Claude budget (T34) | `GET /v3/vault/payment-tokens/{id}` and Transaction Search for `my_agent_card` (via `readAgreement`) | Claude's reply, a trace of the tools it used, and, when it calls `request_reorder`, the pending order for the judge's tab to check, sign and submit. Never signs. Stateless: the browser sends its agreement ID and the visible conversation (≤ 16 short messages) each time |
| POST | `/api/webhooks/paypal` | PayPal signature, verified first, after a header prefilter and a per-instance cap (T25) | `POST /v1/notifications/verify-webhook-signature`, then re-fetches | 200 |
| GET | `/api/health` | Public | none | Status |

**`apps/agent`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/mcp/<heroSecret>` | Secret path (demo-grade); accepts only `HERO_AGREEMENT_ID` | MCP tools: `my_agent_card`, `browse_catalog`, `request_reorder`, `revoke_agreement` |
| POST | `/mcp/<judgeSecret>` | Secret path in the Devpost instructions; accepts only `JUDGE_AGREEMENT_ID` | MCP tools: `my_agent_card`, `browse_catalog`, `request_reorder` (**no revoke**) |
| GET | `/.well-known/agent-key` | Public | Public JWK plus fingerprint |
| GET | `/health` | Public | Status |

**Scripts:** `scripts/spike/*`; `pnpm seed:charge` (§2); `pnpm run doctor`; `pnpm smoke <web-url> [--agent <url>] [--charge]` (read-only unless `--charge`).

## 6. AI components

| Component | Claude does | Claude never does |
|---|---|---|
| Terms compiler | Turns plain English into draft terms plus a plain-language readback | Finalize terms. The shopper confirms, then approves on PayPal |
| Shopping agent (Maya's assistant) | Understands "keep Biscuit stocked," browses, proposes a reorder, presents the agent card | Hold keys, sign, or pay |
| Dispute analyst | Reads the case (checks, PayPal objects, and the buyer message as untrusted data); drafts the response and the inquiry message with citations | Decide to contest or concede; send without Sam |
| Investigator brief and Studio agent | Summarizes checks with citations; answers queue questions from deterministic filters | Rule |

## 7. Dispute playbooks

**Triage is deterministic and runs before Claude** (the §5.6 table):
- **`BUYER_FAVOR` rows → recommend a refund.** Use `accept-claim`, or `make-offer` at INQUIRY. Claude drafts a courteous note.
- **None rows → no recommendation.** Flag for Sam and for PayPal review.
- **`SELLER_FAVOR` rows → resolve at inquiry if possible, otherwise contest.**

**Inquiry first, where PayPal opens one.** While the dispute is in `INQUIRY`, send Maya her own approval in plain language. For example: "On Oct 21 you approved, on PayPal, one bag of Salmon & Rice per period up to $65, by your agent only. This order was requested and signed by that agent. It was charge 3 of that agreement." Include how to cancel. **[spike]** If UNAUTHORISED skips INQUIRY, drop this beat; don't build a workaround.

**Evidence by reason.** Types come from PayPal's `evidence_type` enum; there is no `PROOF_OF_AUTHORIZATION`.

| Reason | Evidence types | Content (all re-derived from PayPal) |
|---|---|---|
| UNAUTHORISED | `BILLING_AGREEMENT`, `ORDER_DETAILS`, `PROOF_OF_FULFILLMENT` | Terms with the agent fingerprint; the signed mandate; the charge within terms; prior undisputed charges; tracking |
| CANCELED_RECURRING_BILLING | `BILLING_AGREEMENT`, `ORDER_DETAILS` | Agreement active at charge time |
| INCORRECT_AMOUNT / DUPLICATE_TRANSACTION | `ORDER_DETAILS`, `BILLING_AGREEMENT` | Amount ≤ cap and = the signed amount; one charge per period |
| MERCHANDISE_OR_SERVICE_NOT_RECEIVED | `PROOF_OF_FULFILLMENT` (with `tracking_info`) | Tracker and status |
| MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED | `ORDER_DETAILS` | Approved SKU = signed SKU = ordered SKU |

**Evidence file.** A PNG of the check table plus notes. Its JSON appendix lists every PayPal object ID and the JWS. Generated per request, never stored.

**Fees, accurately.** PayPal's standard dispute fee is not charged on claims filed as unauthorized, on claims decided in the seller's favor, or on inquiries resolved without escalation. The dispute ratio counts item-not-received and not-as-described claims. Don't claim fee savings on unauthorized claims.

## 8. Sandbox spike (go/no-go), Oct 14–17

Scripts live in `scripts/spike/`. Results go in `docs/decisions/0001-sandbox-spike.md` **as a public record**, with scrubbed responses saved as fixtures. **Use a standard merchant REST app with Vault enabled, not a platform/multiparty app** (`NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`).

1. **Orders basics:** OAuth; create and capture an order with:
   - `custom_id` (with `:`) and `invoice_id`;
   - the purchase-unit description;
   - `items[0]` with `name`, `sku`, `quantity`, `unit_amount`, and a ~600-character description;
   - a matching `breakdown.item_total`.

   Confirm everything round-trips on GET order, and note what the buyer's receipt shows. *(Must pass.)*
2. **Agreement with terms:** create a setup token (`UNSCHEDULED_PREPAID`; also try `RECURRING_PREPAID`. **Result:** only `RECURRING_PREPAID` is accepted with a `billing_plan`) with the terms in `description`, a `billing_plan` with `one_time_charges.total_amount`, and `permit_multiple_payment_tokens: true`.
   - Approve as the sandbox buyer and **screenshot what PayPal shows**.
   - Confirm `description` round-trips.
   - Confirm a second agreement for the same buyer gets a distinct token.
3. **Charge without the shopper:** create an order with `vault_id` and `stored_credential`.
   - **Go/no-go:** the order echoes `attributes.vault.id`. **Result (10-15): no echo.** The labels-plus-payer fallback (§12) is in place.
   - Also record auto-completion and `seller_protection`.
4. **Duplicate-period guard:** confirm "block accidental payments" is on and expect `DUPLICATE_INVOICE_ID` on a second charge. Test whether a declined attempt consumes the ID. Test that a reused `PayPal-Request-Id` returns the original order.
5. **Revocation:**
   - Merchant-side: DELETE the token, try a charge, GET the token, and watch the webhooks.
   - Buyer-side: cancel from the buyer's PayPal settings and record what happens.
   - Check whether `webhooks-events` returns past deletion events.
6. **History:** Transaction Search finds charges by window, `custom_field` keeps `:`, and the lag is measured.
7. **Disputes:** the sandbox buyer opens UNAUTHORISED and NOT_RECEIVED disputes in the UI.
   - Record the initial stage.
   - Confirm `seller_transaction_id`, `custom`, and `invoice_number`.
   - Run escalate (if INQUIRY) → `require-evidence` → `provide-evidence` → `UNDER_REVIEW` → `adjudicate`, then read `adjudications[].reason`.
   - Confirm the multipart part names.
   - Try `send-message` at INQUIRY, and buyer cancellation.
8. **Tracking:** POST `/track`; read it back from GET order.
9. **Crypto and agent plumbing:**
   - `jose` 6.x ES256 with an embedded `jwk`, and RFC 7638 thumbprints, in Node 22 and a browser test.
   - WebCrypto non-extractable P-256 signing in the browser.
   - The Claude connector calls the runtime's tools.

**Go/no-go:** steps 1–4 (including the vault echo), 7, and the crypto part of 9 must pass, or the design changes before Oct 21. **Then start the first seed agreement on the demo cadence by Oct 21**, with mandates signed by `apps/agent`'s seed signer and submitted by `pnpm seed:charge` (§2), even before the gate exists.

## 9. Schedule (solo; teaching mode adds about 15–20% to every task)

| Days | Dates | Work |
|---|---|---|
| 1–4 | Oct 14–17 | Spike (§8), published as you go. Discord questions. |
| 5–7 | Oct 18–20 | `readback-core`: grammar, money and period math, thumbprint, mandate sign/verify/hygiene, IDs; fast-check and fixture tests; CI. **Generate the production agent key** (`AGENT_PRIVATE_KEY`, the same value later deployed to the runtime) and a minimal `apps/agent` seed signer using `readback-core`. Otherwise the hero agreement's fingerprint won't match the deployed runtime. **Oct 20: format freeze and Fable architecture review.** |
| — | **Oct 21** | **First seed agreement live on the demo cadence, signed by script.** |
| 8–13 | Oct 21–26 | Agent runtime (MCP v2, key, pre-check, signing, agent card); gate; shopper flow; eleven checks and classification on spike fixtures. Fable security review against `THREAT-MODEL.md`. |
| 14–18 | Oct 27–31 | Hand-open about 15 disputes, **on separate agreements**. On the hero agreement, dispute only the hero capture and the unsigned twist charge, so prior captures stay undisputed for check 11. Dispute pipeline. Case view with four lights, Tape widget, preview mode, re-verify. Deploy to Render. **Oct 27: PayPal Q3 earnings call.** |
| — | **Sun Nov 1** | **Demo-critical path green on the hosted site:** approve → signed charge → PayPal refuses the duplicate → a dispute → the case view shows both verdicts, re-verified in the browser. **No exceptions.** |
| 19–21 | Nov 1–3 | **AG Studio trial starts Nov 1.** Queue widget, theming from shared tokens, Studio Agent Framework, merchant role toggle. AP2 import. |
| 22–24 | Nov 4–6 | Judge mode (guided rail, Be the agent, Be a dishonest merchant, chat panel). `@readback/core` and `@readback/verify` on npm. Agent Toolkit PR. MCP Inspector check. **Video script and storyboard locked Nov 4.** |
| 25 | Nov 7 | "Judge it yourself" scoreboard. Doctor script, Deploy to Render, axe in CI. Buffer for slips. |
| 26–27 | Nov 8–9 | Record and edit the video (§11). Three cold viewers. README and Devpost page. |
| 28 | Nov 10 | **Fable pre-submission audit**, fixes. |
| — | **Nov 11** | Tag `v1.0-submission` and submit. **Nov 12, noon PT:** hard deadline. |

**If Nov 1 slips**, drop in this order:
1. AP2 import;
2. the simulated-volume toggle;
3. the MCP Inspector beat;
4. the Claude connector (the chat panel stays).

**Never drop:** the demo-critical path; Be the agent and Be a dishonest merchant; the AG Studio queue with the Studio Agent Framework; the two video days.

**Already cut:**
- a separate merchant page;
- the AP2 exporter;
- the evidence PDF;
- the `.mcpb` extension;
- the egress allowlist;
- the merchant ops agent;
- an inquiry workaround.

## 10. Evaluation (`evals/`)

**Scenarios.** About 51, with labeled outcomes, run against recorded PayPal responses plus a live sandbox subset:
- **8 legitimate purchases**, including a period boundary (sign at 23:59:58, capture at 00:00:01) and the last day before expiry.
- **6 attack pages:** hidden instructions, fake system text, price swap, SKU swap, merchant redirect, quantity bump. Measured at both the runtime and the gate.
- **5 gate violations:** revoked, over cap, wrong SKU, second charge in period, after end.
- **7 signature attacks:**
  - forged;
  - unapproved key;
  - header with an extra member or `jku`;
  - payload mismatch;
  - expired;
  - past-period;
  - mandate resubmitted into a second order.
- **8 disputes across the classification table**, including 4 the merchant should lose (one is a stripped-labels direct charge) and 1 consent-unverified.
- **2 injected dispute messages.**
- **Guard and robustness cases (11):**
  - T32 endpoint guards: `DEMO_MODE` off, live base URL, and a second direct charge (3).
  - A direct charge with no `stored_credential`, which must still give `BUYER_FAVOR` (1).
  - Amount-format variants such as "65" vs "65.00" (1).
  - A spoofed webhook (1).
  - A duplicate webhook that must not double-submit (1).
  - Secondary terms downgrading a seller-favor result (1).
  - Provisional history under 3 hours (1).
  - The runtime refusing an agreement that doesn't carry its fingerprint (1).
  - A merchant action without `MERCHANT_ADMIN_TOKEN` (1).
- **Action-proof and judge-path cases (4):** wrong key, wrong purpose, stale `iat`, and revoke refused for the judge agreement.

**Property-based tamper fuzzing** (fast-check): mutate any **field the checks read** in a recorded fixture. That means the terms string; the JWS header, payload, and signature; `vault.id`; amounts and breakdown; SKU and quantity; `invoice_id`; `custom_id`; capture time; and tracker status. The classification must change or be flagged. Report the **measured** catch rate over 10,000 mutations; the target is 100%.

**Report** (CI, committed, badges; also runnable in the browser):
- gate accuracy;
- attacks blocked at each layer;
- signature attacks caught;
- classification accuracy;
- **rulings correct, including against the merchant** (hero number);
- wrongful-contest rate (target 0);
- tamper detection;
- citation validity;
- median time to verify;
- **bytes written by Readback at runtime (target 0)**.

**State the limitation:** the scenarios are our own. The fuzzing and the open fixtures let others challenge them.

## 11. Demo video: "Same claim, two verdicts" (under 3:00)

Judges aren't required to test the project, so **the video is the primary evidence**.
- **Recording:** against live sandbox state on the demo cadence, at 1440p with zoom-ins and cursor highlight.
- **Audio and text:** a separately recorded voiceover and burned-in captions.
- **On screen:** a fixed role chip (Shopper / Agent / PayPal / Investigator), and every PayPal object ID captioned.
- **Rules:** royalty-free music only. Check the Rules on third-party trademarks before showing any assistant's interface; PayPal's sandbox is fine.

| Time | Beat |
|---|---|
| 0:00–0:10 | **Cold open.** A dispute notification: *"$64.99 — 'I didn't buy this. My AI did.'"* VO: "Every AI shopping agent will hear this. Today PayPal reviews the transaction, not what the agent was allowed to do." |
| 0:10–0:32 | **Delegate.** Maya types one sentence. The readback card: "one bag a month, up to $65, until March, by your agent only." Her agent shows its fingerprint; PayPal's page shows the same one; she approves. VO: "Those terms now live in PayPal. Nobody can edit them, not even us." |
| 0:32–0:55 | **Buy.** In her assistant: "Biscuit's low." The agent signs, and the order appears in the PayPal sandbox with the terms and invoice. Asked again, PayPal itself refuses. A 4-second flash: an injected "premium bundle" page, refused. Her agent card shows what it bought. |
| 0:55–1:15 | **Inquiry** (if the sandbox allows). The dispute opens. Maya receives her own approval in plain words and closes the dispute herself. VO: "Most cases should end here." |
| 1:15–1:55 | **Investigator.** The claim that escalated, in the AG Studio queue. One click: Consent, Agent, Terms, and Delivery go green, each tied to a PayPal object. Re-verified in the browser in milliseconds. Suggestion: seller's favor. The recorded sandbox ruling shows PayPal's own reason. |
| 1:55–2:25 | **The twist.** The next row: same shopper, $59, every term respected. Agent: **red**. "The merchant charged her wallet directly; her agent never asked." Suggestion: refund, against the merchant running Readback. VO: "That's why it's believable: it rules against the merchant running it." Cut: a judge in judge mode presses "Be a dishonest merchant" and gets the same red light with their own key. |
| 2:25–2:50 | **Proof.** The eval scoreboard (the measured tamper catch rate), `npx @readback/verify`, the Agent Toolkit PR, zero bytes written. "Every fact is PayPal's." |
| 2:50–3:00 | **Close.** "Readback. The safe way to let your AI shop with PayPal." |

Test the cut on three cold viewers. Each must restate the problem and the twist in one sentence after one viewing.

## 12. README (judge-facing, for human and AI reviewers)

1. **Top section:**
   - the one-line pitch;
   - a 30-second GIF of "same claim, two verdicts";
   - hero metrics (rulings correct including against the merchant, the tamper-fuzz catch rate, zero bytes written);
   - a "Try it" link to judge mode.
2. **10-line quick-start** for existing PayPal merchants (§5.8).
3. **The problem**, with sources (short; link `WHY-PAYPAL.md`), and who adopts it (§1.1).
4. **How it works:** a diagram from the assistant → agent runtime (signs) → gate (verifies) → PayPal (system of record) → investigator and CLI (re-derive).
5. **One section per judging criterion, each with a GIF:**
   - **Technological Implementation:** PayPal APIs used and how; the public spike record; the AP2 mapping and AP2 import; standards (RFC 7515, 7518, 7638; RFC 7800 `cnf` via the AP2 mapping); MCP; Claude's role; the stateless definition; the PayPal-enforced period guard; deterministic idempotency.
   - **Design:** the design system, judge mode, accessibility (axe badge, keyboard GIF).
   - **Potential Impact:** shoppers, merchants, PayPal; sourced numbers; eval results; `PROPOSAL-agent-terms.md`.
   - **Innovation:** what's new vs. AP2, Verifiable Intent, Agent Ready, WebMCP, and dispute vendors, with honest overlaps.
   - **Presentation:** the video link.
6. **Run it:** hosted URL; Deploy to Render; local setup with `doctor`; connector setup.
7. **Security:** link `THREAT-MODEL.md`.
8. **Limitations**, stated plainly.
9. License; contributing.

## 13. Prize targeting

- **Grand prize:** all five criteria. The video and judge mode carry Presentation and Design; the npm packages, toolkit PR, and AP2 import carry Tech and Innovation; the proposal and the eval results carry Impact.
- **Best Use of Agentic Commerce:** use the phrase in the Devpost text and the video.
- **AG Grid (sponsor prize):** a project can win at most one sponsor prize. The AG Grid page judges look and build quality, and asks for custom widgets, theming, layout, and the Studio Agent Framework; all four are core. Render is hosting only.

## 14. Submission checklist

- [ ] Public repo, Apache-2.0 visible in the About section.
- [ ] Hosted demo on Render (two Starter services) live through Dec 15, 2026; AG Studio license valid through Dec 15; uptime check on.
- [ ] Clean-clone setup verified with `doctor`.
- [ ] Sandbox credentials and the connector URL only in the Devpost testing instructions.
- [ ] Video under 3:00, public on YouTube, royalty-free audio, trademark check done.
- [ ] Devpost text lists every AI tool and how it's used.
- [ ] npm packages published; toolkit PR open and linked.
- [ ] Tag `v1.0-submission`; Devpost points at the tag.
- [ ] Re-read the Official Rules a week before submitting; re-check the gallery for overlapping entries.

## 15. Non-goals

- Any database, persistent storage, or runtime writes.
- A general shopping agent; cross-merchant mandates (AP2 import shows the path).
- Browser automation; crypto payments.
- Network-level agent identity (Visa Trusted Agent Protocol, Mastercard Agent Pay) and agent-provider attestation.
- Key rotation within an agreement.
- Signing shipping, tax, or discounts.
- Real money; a marketplace; mobile apps.
- Pre-charge notifications; ruling on account takeover.

## 16. Risks

| Risk | Mitigation |
|---|---|
| No vault echo on orders | **Happened (spike step 3, 10-15).** Fallback in place: labels name the agreement, PayPal's payer match confirms it (check 2a). The label-stripping gap is documented (THREAT-MODEL T3) |
| PayPal's approval page shows little of the terms | **Confirmed:** only `billing_plan.name`. The plan name carries the readable terms and grouped fingerprint; the readback card and the runtime's fingerprint display are the disclosure; the plan name isn't bound to the stored terms (T21) |
| Item description awkward on the receipt | Move the JWS to a second line item ("Agent authorization record"), or keep only `mandateHash` and document it |
| Duplicate blocking off, or failed attempts consume IDs | The gate still enforces cadence; check 7's fallback |
| Seed agreement late, so the hero case can't be recorded | Seed by Oct 21: signed by `apps/agent`'s seed signer, submitted by `pnpm seed:charge` (§2). It's a dated milestone |
| Claude connector problems | Judge-mode chat panel; MCP Inspector |
| Judge-held key or the dishonest-merchant button abused | Demo-only guardrails (THREAT-MODEL T31, T32) |
| Key swap at setup by a dishonest merchant | Not stopped by code; the guided fingerprint check; `PROPOSAL-agent-terms.md` closes it |
| AG Studio license expires during judging | Trial starts Nov 1; ask AG Grid for an extension |
| Render cold starts | Starter instances, health checks, uptime check |
| Sandbox outage during judging or recording | Recorded fallback clips; labeled fixtures in the queue |
| Investigator view read as a PayPal integration or as independent | "Proposed workflow" and "re-derivable" labels; the CLI removes dependence on merchant-hosted code (it still needs the merchant account's API access) |
| Scope vs. 29 days (Oct 14–Nov 11), solo, new to TypeScript | Dated critical path, drop order, teaching-mode budget. Optional: a design/video teammate (no team-size limit) |

## 17. References

Primary sources are listed in `docs/WHY-PAYPAL.md`. Technical references:
- PayPal REST API specifications (OpenAPI): github.com/paypal/paypal-rest-api-specifications. Vault v3, Orders v2, Payments v2, Disputes v1, Transaction Search, Webhooks.
- Orders v2 errors: developer.paypal.com/api/rest/reference/orders/v2/errors/
- Webhook events: developer.paypal.com/api/rest/webhooks/event-names/
- Disputes guide: developer.paypal.com/platforms/disputes/
- Transaction Search: developer.paypal.com/docs/transaction-search/
- Recurring payments module: developer.paypal.com/studio/checkout/standard/customize/recurring-payments-module
- AP2 repo @ v0.2.0 (github.com/google-agentic-commerce/AP2): `docs/ap2/specification.md`, `docs/ap2/payment_mandate.md`, `code/sdk/schemas/ap2/`, `code/sdk/python/ap2/tests/agent_recurrence_tests.py`
- RFC 7515 (JWS), RFC 7518 (ES256), RFC 7638 (JWK thumbprint), RFC 7800 (`cnf`)
- `jose` 6.x: github.com/panva/jose
- MCP TypeScript SDK v2: ts.sdk.modelcontextprotocol.io; MCP Inspector: github.com/modelcontextprotocol/inspector
- Claude custom connectors: claude.com/docs/connectors/custom
- AG Studio: ag-grid.com/studio/react/custom-widgets/ and /ai-agents/; hackathon boilerplate github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate
- Render: render.com/docs/free, render.com/pricing
- PayPal Agent Toolkit: github.com/paypal/agent-toolkit (v1.11.0)
