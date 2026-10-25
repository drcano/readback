# Readback

**The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.**

Agent purchase mandates and dispute evidence, built entirely on PayPal's own records. Runs against the PayPal **sandbox**. Built for the PayPal AI Hackathon (2026).

![Same claim, two verdicts: a signed, in-terms purchase is upheld; a charge the merchant made directly is refunded](docs/assets/landing.png)

| | |
|---|---|
| **Rulings** | 59/59 labeled scenarios behave as labeled. **0** wrong suggestions toward the seller, **0** toward the buyer ([results](evals/results/latest.json)) |
| **Tampering** | 2,000 random single-field mutations of an upheld case: **0** still upheld. 10,000 more in the core test suite |
| **Storage** | **Zero.** No database, no files, no caches. PayPal is the only system of record |
| **Accessibility** | axe-core: **0** WCAG 2.1 AA violations on 7 pages, light and dark |

**Try it:** run it locally in a few minutes ([Run it](#run-it)). Both verdicts, the investigator, the evals and the AP2 check work without any credentials, on labeled fixture data; approving and buying use the PayPal sandbox. <!-- TODO(submission): hosted URL and the YouTube video link go here. -->

---

## The problem

Maya asks her AI to keep her dog's food stocked. A month later a charge appears and someone says **"I didn't buy this. My AI did."**

- PayPal says it evaluates such claims on the transaction itself, regardless of whether a person or an AI started it, and that it does not assess AI intent; an agent acting without authorization is typically reviewed as an unauthorized payment. Nothing in that review records **what the shopper actually delegated**. ([WHY-PAYPAL.md §1](docs/WHY-PAYPAL.md), source S1)
- Where a billing agreement existed but the dates and amounts agreed to couldn't be shown, UK ombudsman decisions have gone against PayPal. In the US, authorization turns on what authority the consumer gave. ([§2](docs/WHY-PAYPAL.md))
- PayPal's own developer blog says agent actions should stay attributable to the person who authorized them and the agent that executed them. ([§1](docs/WHY-PAYPAL.md), P9)

**Who it's for.** Shoppers get a hard limit their agent can't exceed. Merchants win the agent disputes they should win, and the tool is believable because it recommends refunds for the ones they should lose. PayPal's investigators get a case rebuilt from PayPal's own records. Full sourced case: [docs/WHY-PAYPAL.md](docs/WHY-PAYPAL.md).

## How it works

```
Maya's assistant ──asks──▶ agent runtime ──signs (ES256)──▶ checkout gate ──charges──▶ PayPal
 (any MCP client)          holds the agent key              verifies, decides         (system of record)
                           no PayPal credentials            stores nothing
                                                                                         │
                       investigator view & re-verify in the browser ◀──reads─────────────┘
```

1. **Consent on PayPal.** Maya says it once; her agent reads it back as exact terms. She approves them on **PayPal's own approval page**: merchant, item, cap, cadence, dates and her agent's key fingerprint. PayPal stores them in the payment token's `description`, which can't be edited afterwards.
2. **Signed requests.** Each purchase is a closed mandate (compact JWS, ES256 over P-256) signed by her agent runtime, which refuses anything outside the terms *before* signing.
3. **A deterministic gate.** The merchant's gate verifies the signature, re-reads the terms from PayPal, checks every limit, and charges the saved wallet with an `invoice_id` naming the period, so **PayPal itself refuses a second charge** in the same period.
4. **Eleven checks.** When a dispute arrives, Readback rebuilds the case from PayPal's records (dispute → capture → order → terms), verifies the signature, runs eleven checks, and suggests an outcome only when the evidence supports one.

**Same claim, two verdicts.** A signed, in-terms purchase that Maya disowns → the evidence supports the **seller**. A charge the merchant made itself, with no request from her agent → the evidence supports the **buyer**, against the merchant running Readback. One standard for both sides ([ADR 0004](docs/decisions/0004-neutrality.md)).

**Principles:** LLMs propose; cryptography and deterministic checks decide. Readback stores nothing; PayPal is the only system of record. Diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Technological implementation

**PayPal, used deeply and verified against the sandbox.** Every call path below was run against the sandbox and recorded, scrubbed, in a public [spike record](docs/decisions/0001-sandbox-spike.md) with fixtures in [`evals/fixtures/spike/`](evals/fixtures/spike).

| PayPal API | What Readback does with it |
|---|---|
| Vault v3 setup and payment tokens (`RECURRING_PREPAID`) | The shopper's approved terms and agent fingerprint, held by PayPal and uneditable |
| Orders v2 with `vault_id` and `stored_credential` | Merchant-initiated charges carrying the signed mandate, terms copy, `custom_id` and period `invoice_id` |
| PayPal's duplicate-invoice guard | One charge per period, enforced by PayPal, not by Readback |
| Payments v2 captures | The link from a dispute to the order and agreement |
| Disputes v1 | Read disputes; respond through whichever action the dispute's own links offer (supporting info or evidence, multipart) |
| Transaction Search | Prior undisputed charges under the agreement, confirmed by PayPal's payer match |
| Orders v2 tracking | Shipment evidence for the Delivery check |
| Webhooks (verify-webhook-signature) | Events are verified with PayPal before anything acts on them |

Deterministic `PayPal-Request-Id` on every POST (retries are no-ops; timeouts retry once with the same ID). Integer-cent money, UTC dates, fail-closed everywhere.

**AI, where it helps, never where money is decided.** Readback uses Claude (Anthropic API) in five places:

| Where | What Claude does | What decides |
|---|---|---|
| Shopper's assistant | Drives the agent runtime's MCP tools (agent card, catalog, reorder, revoke). Try it in **"Ask the agent to shop"** on the home page, or from any MCP client | The runtime signs only in-terms requests; the gate re-checks; PayPal refuses a second charge per period |
| Terms compiler | Drafts structured terms from Maya's sentence | Code validates them and writes the readback card |
| Investigator brief | Explains a case in plain English | A validator rejects any sentence without a citation to a check or a PayPal record |
| Ask the queue | Picks one of nine named filters from a question | Code does the filtering |
| Claude-driven harness | Plays the shopper's assistant over the real tools, attack pages included | Graded only on what got signed and charged ([results](evals/results/harness-latest.json)) |

Claude never holds a key and never makes an allow/deny or ruling decision. Product pages and buyer messages reach Claude only inside delimited untrusted-data blocks. The project was also built with Claude Code.

**Standards and crypto.** ES256 compact JWS (RFC 7515/7518) with pinned algorithms and exact-header hygiene; RFC 7638 JWK thumbprints as the agent fingerprint; `jose` over WebCrypto, so the same checks run in Node and in the browser. The agent runtime is an MCP server (TypeScript SDK v2, streamable HTTP, stateless).

**Interoperability.** Readback runs AP2 v0.2's autonomous-purchase model on PayPal's existing rails, and `/ap2` verifies AP2's own published mandate chain in the browser.

**Try to break it.** `/judge` runs eight attacks through the product's real layers in your browser and shows where each one dies: a poisoned product page stops at the agent runtime; a forged key, an edited request and a fake sale price stop at the checkout gate; a second bag and a charge after cancelling stop at PayPal; and the store charging her wallet itself gets past all three and is caught by the investigator.

![Attack lab: where each attack was stopped](docs/assets/attack-lab.png)

**Tested.** `@readback/core`: 153 tests at about 98% coverage, property-based tamper fuzzing, and a headless-browser run. 59 labeled eval scenarios. End-to-end judge flow in Chromium. An independent security review found two seller-leaning issues; both are fixed and kept as regression tests ([ADR 0005](docs/decisions/0005-independent-audit-oct15.md)). Threats T1–T34 and their mitigations: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Design

One product, three roles, one design system: the shopper delegates, the agent buys, the investigator decides. Every state is carried by a word or symbol as well as color, every denial has a plain-language message, and axe-core reports zero violations in light and dark mode.

| The shopper approves once | The investigator sees why |
|---|---|
| ![Shopper: the readback card](docs/assets/shopper.png) | ![Case view: refund the buyer, her agent never asked](docs/assets/case-twist.png) |

The investigator queue (AG Grid) shows each dispute's evidence at a glance; the case view walks the evidence chain, each step tied to a PayPal record, re-checked in the browser.

![Investigator queue](docs/assets/queue.png)

**Ask the agent to shop** on the home page puts Claude in the shopper's seat, driving the demo's shared agent under the demo agreement (on a deployment that has one): ask it to reorder, to buy what a poisoned product page recommends, or to order three bags, and watch which requests the agent signs and PayPal charges.

**Judge mode** on the home page lets you be the agent: your browser tab generates a non-extractable key, you approve its terms on PayPal's sandbox page, sign a purchase, then press **"Be a dishonest merchant"**, and see **your own two charges side by side**: your agent's, and the store's with the Agent light red and "Refund the buyer", against the store running the tool.

## Potential impact

- **Shoppers** can let an agent spend within limits they approved on PayPal, and a merchant can't charge in their agent's name without the agent's signature.
- **Merchants** get evidence that wins the disputes they should win, with a 10-line integration (below) and nothing new to store.
- **PayPal** gets the record its own review currently lacks, on rails it already runs. [docs/PROPOSAL-agent-terms.md](docs/PROPOSAL-agent-terms.md) sketches the one API change (an `agent_terms` object on Vault payment tokens) that would move these checks inside PayPal.

Developer surfaces: `@readback/core` (the checks), `npx @readback/verify <disputeId>` (re-derive any case from PayPal with the merchant's API credentials), and a prepared change to PayPal's Agent Toolkit adding `verify_agent_purchase` and `provide_dispute_evidence` and fixing two reproduced `accept_dispute_claim` bugs.

## Innovation

Readback isn't the first to record what a user authorized; AP2, Mastercard Verifiable Intent, Amex and others do or plan some of this ([WHY-PAYPAL.md §5](docs/WHY-PAYPAL.md) lists them honestly). What's new:

1. **AP2's autonomous model on PayPal rails that exist today**: PayPal's approval page is the trusted surface, the stored terms are the open mandate, and agent-signed requests inside each order are the closed mandates. No new network, issuer or protocol.
2. **A merchant can't fabricate the shopper's agent.** A charge with no valid signature is suggested for the buyer even when it fits every term. Terms alone can't catch that; signatures alone can't decide it without PayPal's records.
3. **PayPal enforces limits itself**: one charge per period through invoice uniqueness, and no charges on a cancelled agreement.
4. **Built for the adjudicator, not the merchant's advocate**: deterministic checks, re-derivable in the browser, with no suggestion where the evidence can't support one.
5. **Zero data outside PayPal.**

## Presentation

<!-- TODO(submission): YouTube link (under 3:00). -->
Video: *"Same claim, two verdicts"*, under three minutes ([script](docs/VIDEO-SCRIPT.md)).

---

## Quick-start: an existing PayPal merchant, about 10 lines

If you already charge a vaulted PayPal wallet, Readback adds one decision and a different order body. Runnable offline in [`examples/existing-paypal-merchant`](examples/existing-paypal-merchant/index.ts):

```ts
const decision = await authorizeCharge({ jws, token: await getToken(tokenId), merchant: MERCHANT, itemName, nowSec });
if (!decision.allow) throw new Error(decision.failures.map((f) => f.message).join("; ")); // fail closed
const res = await fetch(`${PAYPAL}/v2/checkout/orders`, {
  method: "POST",
  headers: { ...auth, "PayPal-Request-Id": decision.requestIds.create }, // retries are no-ops
  body: JSON.stringify(decision.orderRequest), // vault_id, signed mandate, terms copy, invoice_id, custom_id
});
```

`jws` is the agent's signed request, and `getToken` is your existing `GET /v3/vault/payment-tokens/{id}`. When a dispute arrives, `npx @readback/verify <disputeId>` (or `buildCaseBundle` + `evaluateCase`) rebuilds the case from PayPal alone:

```bash
pnpm --filter existing-paypal-merchant start
# Charged: order ORDER2 COMPLETED, invoice RB-8kd73hs9ab-P001
# Dispute PP-D-4: Authorized by terms; fulfillment not shown → no suggestion
```

No suggestion is the honest answer there: nothing was shipped, and there's no history of undisputed charges yet.

## Run it

Node 22.18+ and pnpm.

```bash
pnpm install
pnpm --filter @readback/web dev       # http://localhost:3000, no credentials needed
```

Without PayPal credentials you can still see both verdicts on `/` (re-verified in your browser), the labeled fixture cases in `/investigator`, every eval scenario at `/judge`, and AP2's official mandate checked at `/ap2`.

**With the PayPal sandbox** (a standard merchant REST app with Vault, Disputes and Transaction Search enabled):

```bash
cp .env.example .env                  # PayPal sandbox app credentials
cp apps/agent/.env.example apps/agent/.env
pnpm --filter @readback/agent keygen  # prints AGENT_PRIVATE_KEY once; paste into apps/agent/.env
pnpm run doctor                       # checks the configuration (plain `pnpm doctor` is pnpm's own command)
pnpm dev                              # web on :3000, agent runtime on :3001
```

Tests: `pnpm test` · browser: `pnpm test:browser` · evals: `pnpm eval` · end to end: `pnpm --filter @readback/web build && pnpm --filter @readback/web test:e2e` · Claude harness: `pnpm --filter @readback/agent harness` (needs `ANTHROPIC_API_KEY`).

## Status

| Piece | State |
|---|---|
| `packages/readback-core`: terms grammar, ES256 mandates, fingerprints, labels, gate decision, eleven checks, classification, AP2 import | Built and tested (see above) |
| `apps/agent`: MCP agent runtime, stateless, two secret paths | Built; tested over MCP, with MCP Inspector, by the Claude harness, and live through the home page chat panel |
| `apps/web`: shopper flow, judge mode, investigator queue and case view, checkout gate, agreements, webhooks | Built; tested against an in-memory PayPal fake and end to end in Chromium |
| Sandbox spike | Steps 1, 2, 4, 6, 8 and 9 pass. Step 3's charge passes, but PayPal sends no vault echo; the labels-plus-payer fallback is in place. Step 5's merchant side is done; buyer-side cancel is *pending*. Step 7: a real dispute reads end to end, and the sandbox adjudicated it alone overnight; an unauthorized-claim dispute is *pending*. ([record](docs/decisions/0001-sandbox-spike.md)) |

## Repository

| Path | What |
|---|---|
| `packages/readback-core` | Pure, browser-safe verification: everything that decides anything |
| `packages/verify-cli` | `@readback/verify`: the CLI and the typed PayPal client |
| `apps/agent` | The agent runtime (holds the agent key; MCP server) and the Claude harness |
| `apps/web` | The merchant's Readback deployment (Next.js) |
| `examples/existing-paypal-merchant` | The 10-line quick-start, runnable offline |
| `evals/` | Labeled scenarios, fixtures and results |
| `scripts/` | Sandbox spike, `seed:charge`, `agreement:create`, `doctor` |
| `docs/` | Spec, threat model, the case for PayPal, the API proposal, decision records |

## Security

[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) lists every threat (T1–T34), its mitigation, and the eval that covers it. Secrets live only in server environment variables; only the agent runtime holds a private key; webhooks are verified with PayPal before use; untrusted content reaches Claude only as delimited data.

## Limitations

Stated plainly in [WHY-PAYPAL.md §8](docs/WHY-PAYPAL.md). In short:
- Sandbox only.
- The investigator view is a proposed workflow. Its results are re-derivable from PayPal, but it isn't independent of the merchant's API access.
- Judge mode holds a demo key in the browser tab (THREAT-MODEL T31).
- A key swap at setup is stopped only by the shopper comparing fingerprints (T21); the API proposal closes it.
- Until spike step 5 shows whether PayPal's deletion events are retrievable, "charged after cancellation" is detected through PayPal refusing charges on a cancelled agreement, not from the deletion time.
- Readback never asserts Seller Protection eligibility; it shows PayPal's own `seller_protection` field.

## License

Apache-2.0.
