# 0001 — Sandbox spike (go/no-go)

Status: in progress (started 2026-10-14). Steps 1–4, 6 and 8 done, 5 merchant side done, 7 partial (one dispute adjudicated by PayPal itself; Readback's evidence written into a second, live one); remaining: step 7's `UNAUTHORISED` dispute and one we drive to `adjudicate`, and step 5's buyer-side cancel and webhook. Public record, linked from the README.

Each row is filled from a real sandbox run against a **standard merchant REST app** (not a platform app). Failures are recorded, not hidden. Scrubbed responses are saved under `evals/fixtures/spike/`. Steps are defined in `docs/SPEC.md` §8.

| # | Step | Go/no-go | Script | Result | Fixtures |
|---|---|---|---|---|---|
| 1 | Orders basics: every Readback field round-trips on GET | **yes** | `scripts/spike/01-orders.ts` | **PASS** (10-15) | `01-*.json` |
| 2 | Agreement with terms: setup token → approval → payment token; `description` round-trips | **yes** | `02-agreement.ts` | **PASS with `RECURRING_PREPAID`**; `UNSCHEDULED_PREPAID` refused (10-15) | `02-*.json` |
| 3 | Charge without the shopper; order echoes `attributes.vault.id` | **yes** | `03-vault-charge.ts` | charge **PASS**; vault echo **FAIL** (10-15) | `03-*.json` |
| 4 | Duplicate-period guard (`DUPLICATE_INVOICE_ID`), request-ID replay | **yes** | `04-duplicate-guard.ts` | **PASS** (10-15) | `04-*.json` |
| 5 | Revocation: merchant DELETE, buyer-side cancel, webhooks | no | `05-revocation.ts` | merchant DELETE done (10-15); buyer cancel and webhook pending | `05-*.json` |
| 6 | History: Transaction Search, `:` in `custom_field`, lag | no | `06-history.ts` | PASS (10-17) | `06-*.json` |
| 7 | Disputes: UI-opened, lifecycle to `adjudicate` | **yes** | `07-disputes.ts` | API reachable; needs a UI-opened dispute | `07-*.json` |
| 8 | Tracking: `/track` round-trips | no | `08-tracking.ts` | **PASS** (10-15) | `08-*.json` |
| 9 | Crypto (ES256 + thumbprint, Node and browser) / connector | **crypto: yes** | `09-crypto.ts`, `packages/readback-core` browser test | **crypto: PASS** (2026-10-15) | — |

## Known before running (from PayPal's Orders v2 OpenAPI spec)

Source: `openapi/checkout_orders_v2.json` in `github.com/paypal/paypal-rest-api-specifications` (main, fetched 2026-10-14).

| Field | Request max | Response max | Readback's worst case |
|---|---|---|---|
| `purchase_units[].description` | 3000 | **127** | terms string ≤127 (SPEC §4.1) |
| `purchase_units[].custom_id` | 255 | 255 | 79 |
| `purchase_units[].invoice_id` | 127 | 127 | 45 |
| `items[].description` | 4000 | **2048** | signed mandate ~622 |
| `items[].sku` | 127 | 127 | 16 |

The response limits are why SPEC says "retained": PayPal accepts more than it gives back. Step 1 measures what actually comes back.

## Step 9 — Crypto (PASS, 2026-10-15)

- **Node (`node scripts/spike/09-crypto.ts`, Node 26):** 17/17 checks pass. RFC 7638 §3.1 thumbprint test vector matches; ES256 compact JWS with embedded `jwk` signs and verifies; tampered payload, swapped key, `alg: none`, ES384 and a `jwk` carrying `d` are all rejected.
- **Finding:** `jose` itself accepts an extra `kid` header member and `typ: "JWT"`. Only Readback's own exact-header check rejects them, so that check in `readback-core` (`jws.ts`) is load-bearing, and is covered by tests.
- **Browser (`pnpm test:browser`, headless Chromium via Playwright):** readback-core signs with a **non-extractable** P-256 key (it can't be exported), verifies, and re-runs both verdicts (row 13 `SELLER_FAVOR`, row 3 `BUYER_FAVOR`) in well under a second.
- **MCP Inspector (v2.11.0, CLI mode) against the runtime, 2026-10-25,** on the hero path with the web app on localhost and the live sandbox. `tools/list` returns the four tools (`09-mcp-tools-list.json`). `my_agent_card` lists all 11 hero charges with amounts. `browse_catalog` returns the catalog inside an `<untrusted_data>` block, attack pages included. `request_reorder` went agent → gate → PayPal and came back "Already ordered this period (refused by PayPal)", because P011 was already charged. `revoke_agreement` was deliberately not called on the hero.
- **Chat panel (`POST /api/chat`), 2026-10-25 ~23:14Z.** Checked live with a local runtime whose *judge* path was bound to the hero agreement (no revoke tool on that path). "Reorder" went Claude → runtime → gate → PayPal and was refused as already ordered this period; a poisoned catalog and a three-bag request were declined. **Only safe after that UTC day's seed charge:** before it, the same test makes a real hero charge. Use the judge agreement once it exists.
- Not yet tested: the Claude app's custom connector calling the hosted runtime (needs the Render deploy).

## Discrepancies between SPEC.md and PayPal's OpenAPI specs

Checked against `github.com/paypal/paypal-rest-api-specifications` (main, 2026-10-15).

- **Billing plan `frequency` is undefined** in Vault v3 (`#/components/schemas/frequency` is `{}`). We send the Subscriptions v1 shape `{interval_unit: "DAY", interval_count}`, which caps a cycle at 365 days. readback-core refuses to build a plan over 365 days. **[spike step 2]**
- **Dispute reasons** are `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` / `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`; SPEC's NOT_RECEIVED / NOT_AS_DESCRIBED are shorthand. Code uses the real enum.
- **`provide-evidence`:** the OpenAPI spec names only the `evidence-file` part; the `input` JSON part isn't documented there. **[spike step 7]**
- **`send-message`:** the request body is documented as multipart (`message_document`) but described as JSON. The script tries both.
- **Tracking:** `/v2/checkout/orders/{id}/track` doesn't document `PayPal-Request-Id`, so derived idempotency IDs for tracking are unconfirmed. `carrier: OTHER` requires `carrier_name_other`.
- **Error names** (`DUPLICATE_INVOICE_ID`, `INVALID_VAULT_ID`, `AGREEMENT_ALREADY_CANCELLED`, `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`) appear only on PayPal's docs pages, not in any OpenAPI file. Scripts print whatever `details[].issue` really returns.
- **Confirmed as SPEC says:** token IDs `^[0-9a-zA-Z_-]+$` max 36; token `description` max 128; order `purchase_units[].description` returned max 127, `items[].description` returned max 2048; Transaction Search `custom_field` max 127 with a pattern allowing `:` and excluding `|`; `adjudicate` takes only `adjudication_outcome`; `NOT_AN_UNAUTHORIZED_TRANSACTION` and `CUSTOMER_RECOGNIZES_TRANSACTION` are real adjudication reasons; `BILLING_AGREEMENT` and `PROOF_OF_FULFILLMENT` are real evidence types; the disputes list accepts `disputed_transaction_id`.

## Runbook (run in this order once `.env` is filled)

Before starting: `pnpm run doctor` (checks env and app scopes). Standard merchant REST app with **Vault**, **Disputes** and **Transaction Search** on; a webhook (any https URL) subscribed to `VAULT.PAYMENT-TOKEN.DELETED`; in the sandbox **business** account, "block accidental payments" on.

1. `pnpm spike:orders`: approve as **Maya**; note the receipt.
2. `pnpm spike:agreement`: approve as **Maya**, **screenshot PayPal's page**. The return URL 404s; that's expected. Note token **A**.
3. `pnpm spike:agreement --compare=<A>`: approve as Maya again; note token **B**.
4. `pnpm spike:vault-charge <A>`: **go/no-go** on the vault echo. Note the order ID.
5. `pnpm spike:duplicate-guard <A>` (re-runs: add `--scratch=902`, then 903, …).
6. `pnpm spike:tracking <orderId from 4>`.
7. As **Maya** in sandbox.paypal.com/resolutioncenter: open one "didn't authorize" (UNAUTHORISED) and one "didn't receive" dispute on two $64.99 charges.
8. `pnpm spike:disputes list`, then per dispute: `get`, `send-message <id> "text"` (INQUIRY only), `escalate`, `require-evidence`, `provide-evidence` (fallbacks: `--input-as-string`, `--file-part=file1`), `adjudicate <id> SELLER_FAVOR`, `get` again.
9. `pnpm spike:history` now and ~3 hours later (lag).
10. `pnpm spike:revocation <B>` (type DELETE).
11. A fresh `pnpm spike:agreement` → token **C**, then `pnpm spike:revocation <C> --buyer-cancel` and cancel as Maya in Settings > Payments > Manage automatic payments; screenshot each screen.

After the spike, the hero agreement and seed charges (Oct 21):
12. `pnpm --filter @readback/agent pubkey` → note the fingerprint.
13. `pnpm agreement:create <fingerprint> 1` → approve as **Maya**, comparing the fingerprint on PayPal's page → put the printed ID in `.env` as `HERO_AGREEMENT_ID`.
14. `pnpm seed:charge` daily from Oct 15. On Dante's Mac a launchd job (`~/Library/LaunchAgents/dev.readback.seed-charge.plist`, 9:00 local, log in `~/Library/Logs/readback-seed.log`) runs it and a Transaction Search check; a missed run happens on wake. A second run in the same UTC day is refused by PayPal (`DUPLICATE_INVOICE_ID`), so it's safe to run by hand too.

Fixtures from step 3 on are signed with throwaway keys that don't match step 2's terms fingerprint, and their order bodies are built by hand: they record **what PayPal stores and returns**, not product-shaped cases. **Product-shaped fixtures for `readback-core` and the evals come from `pnpm seed:charge`**, which signs with the real agent key and charges through core's `authorizeCharge`; it saves each order as `evals/fixtures/spike/seed-<invoice_id>-order.json`.

## Results, 2026-10-15 (first sandbox run)

**Step 1 (PASS).** All ten Readback fields round-trip byte-for-byte on GET, before and after capture, including the 619-character signed mandate in `items[0].description`. The capture carries `custom_id` and `invoice_id` and links to its order. `seller_protection` came back `ELIGIBLE` for `ITEM_NOT_RECEIVED` and `UNAUTHORIZED_TRANSACTION`. That is PayPal's field, recorded here, not a Seller Protection claim. Not yet recorded: what Maya's receipt shows.

**Step 2 (PASS, with a change).** Five request shapes were tried. With `usage_pattern: UNSCHEDULED_PREPAID`, PayPal rejects every `billing_plan` (`422 INCOMPATIBLE_PARAMETER_VALUE` on `pricing_model`), whether the plan is `VARIABLE` with or without a price, or `FIXED`. `UNSCHEDULED_POSTPAID` fails the same way. Only **`RECURRING_PREPAID` + `VARIABLE`** is accepted. The terms `description` then round-trips byte-equal on create and GET. `billing_plan` is not returned, as SPEC assumed. `usage_pattern` and `permit_multiple_payment_tokens` are not echoed on GET (the script counts these as FAIL; they are informational). A second agreement for the same buyer gets a distinct token ID and a distinct `customer.id`, with the same `payer_id`.
- **The approval page shows only `billing_plan.name`**, prefixed with the brand name ("to Good Boy Provisions: <name>"). The `description` terms string, with the agent fingerprint, is **not shown to the buyer**.
- **Plan-name limits (probed):** max 127 characters; `_` is rejected (`INVALID_PARAMETER_SYNTAX`). Base64url fingerprints can contain `_`.

**Step 3 (charge PASS, echo FAIL: go/no-go).** A vault charge with no buyer present auto-completes on create (no capture call needed). Every label round-trips, and order `payer.payer_id` equals the token's `payer_id`. **No `attributes.vault` anywhere**, under any of these: default GET, `?fields=payment_source`, `Prefer: return=representation`, `stored_credential.usage_pattern` of `RECURRING_PREPAID` (accepted) or `UNSCHEDULED_PREPAID` (also accepted on a recurring token), and on the capture. Listing tokens by the order's payer ID returns 404; `customer.id` (vault-side) never appears on the order. A $1 probe order (`invoice_id …-ECHOPROBE1`) exists on token A.

**Step 4 (PASS).** A second charge in a used period is refused with `DUPLICATE_INVOICE_ID`. This is on by default: the business account's "block accidental payments" setting could not be saved in the sandbox UI, and was not needed. A mocked decline does not use up the invoice ID. Re-sending a `PayPal-Request-Id` returns the original order.

**Step 5 (merchant side).** `DELETE` token → 204. Charging it then fails with **`403 PERMISSION_DENIED`**, not `INVALID_VAULT_ID` or `AGREEMENT_ALREADY_CANCELLED`. `denialFromPayPalIssue` now maps it to `AGREEMENT_NOT_ACTIVE`. GET on the token → 404 afterwards, so terms can't be re-read after revocation. Not yet done: webhook (none registered; needs a public URL) and buyer-side cancel.

**Step 8 (PASS).** `/track` → 201; GET order shows `trackers[]` with `SHIPPED` and the item SKU.

**Decisions (2026-10-15, Dante: proceed):**
1. **Usage pattern:** agreements use `RECURRING_PREPAID`, and the billing cycle carries `start_date` (without it PayPal wants a first payment now). Core's request was re-sent to the sandbox and accepted (commit 4af9012).
2. **Check 2a without the echo:** the echo still wins if PayPal ever sends one. Otherwise the agreement named by `custom_id` and/or `invoice_id` is used (labels naming different agreements = no link), accepted only with PayPal's payer match. Labels can count against the merchant, never for it: a deleted agreement makes the link secondary (no seller-favor suggestion), and history entries count only with the payer match plus a mandate signed by the approved key for that agreement. A charge with both labels and the mandate stripped can't be linked from merchant-side data (THREAT-MODEL T3). Commit c1b1019.
3. **T21 (key swap at setup):** the plan name now ends with the grouped fingerprint, and agent keys are drawn until the fingerprint has no `_`. The plan name is merchant-supplied and not stored, so the comparison on PayPal's page can't prove which fingerprint is in `description`; T21 stays "not stopped by code," and the proposal to PayPal asks it to show the stored terms (commit 4af9012; THREAT-MODEL T21, ADR 0002).
4. **Revoked agreements:** `PERMISSION_DENIED` maps to "agreement not active" (commit 149ecf8).

**Step 7 (partial, 2026-10-15).** Opened as Maya in the Resolution Center on the step 3 spike charge (not the hero agreement): "I haven't received the item" → "hasn't reached me". Findings:
- Before letting her file, PayPal shows the agreement ("automatic payment set up with Test Store, Active") and the merchant's USPS tracking. Merchant-side records are already in PayPal's buyer flow.
- The buyer UI calls it a message to the seller, but the case is a real dispute: `PP-R-BVW-10191531` (Disputes API IDs use `PP-R-…` as well as `PP-D-…`). It went straight to stage `CHARGEBACK`, state `UNDER_PAYPAL_REVIEW`, channel `INTERNAL`, with no inquiry stage; PayPal put a $62.23 `HOLD_PLACED` on the merchant.
- **The list endpoint lagged a few minutes** behind the GET, then returned it under every filter (`start_time`, `dispute_state=UNDER_PAYPAL_REVIEW`, `disputed_transaction_id`, `update_time_after`).
- **The chain works on a real dispute:** `seller_transaction_id` → capture → order; `custom` and `invoice_number` equal the capture's labels.
- In this state PayPal offers only `provide_supporting_info`. `require-evidence`, `provide-evidence` and sandbox `adjudicate` all return `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`. **`provide-supporting-info` accepts a multipart `input` JSON part → 200.** So the merchant actions route must follow the dispute's own `links`, not assume `provide-evidence`.
- **PayPal decided it alone (checked 2026-10-25).** With no merchant response, the sandbox adjudicated about 14 hours after filing: `DENY_BUYER` at 2026-10-16T03:34Z, status `RESOLVED`, outcome `RESOLVED_SELLER_FAVOUR` / `INELIGIBLE_BUYER_PROTECTION_POLICY`, and only a `self` link left (`07-dispute-resolved.json`). So a hand-opened dispute can close overnight. Open the demo's disputes close to recording, and expect the case view to show resolved cases. `@readback/verify` still reads it end to end: dispute → capture → order → agreement, row 3 (`BUYER_FAVOR` suggestion), because the spike charge was signed by a throwaway spike key, not the agreement's. PayPal's ruling and Readback's suggestion differ here for that reason; this charge is not product-shaped.
- **Readback's evidence, written into a live dispute (2026-10-26).** Opened as Maya in the Resolution Center on spike charge P901 (`008512347R795370T`, not the hero): "I haven't received the item" → "hasn't reached me". Case `PP-R-CFY-10194687`. Unlike Oct 15, it opened in the **INQUIRY** stage (status OPEN, then `WAITING_FOR_SELLER_RESPONSE` within a minute), offering `provide_evidence`, `send_message`, `make_offer`, `accept_claim` and `escalate`; the action links took about two minutes to appear. `POST /api/cases/[id]/actions {"action":"send_evidence"}` rebuilt the case from PayPal (row 3, `BUYER_FAVOR`: the spike charge isn't signed by the agreement's key), sent Readback's statement with `provide-evidence` (200), and read it back: PayPal stores it as evidence `PROOF_OF_FULFILLMENT`, `source: SUBMITTED_BY_SELLER` (`07-dispute-after-readback-evidence.json`). After a submission PayPal stops offering `provide_evidence`, so the route checks "already on the record" before the links: a resend says so and sends nothing.
- **Readback's refund, accepted live (2026-10-26).** Dante approved a full refund on the same case. `POST /api/cases/[id]/actions {"action":"refund_buyer"}` rebuilt the case (still row 3, `BUYER_FAVOR`) and sent `accept-claim` with `accept_claim_type: REFUND` and a note written by code (200 at 21:00:16Z). Before sending, a dry run with Disputes writes intercepted showed the exact request: USD 64.99 and request ID `rb-accept_claim-PP-R-CFY-10194687-1d5b7d71fa3f86e3`. Findings:
  - **The refund is immediate.**
    - The capture is `REFUNDED`, and the order lists refund `7EM88034D46537130`, `COMPLETED`, USD 64.99.
    - `money_movements` credit the buyer 64.99 and debit the seller 64.99 plus 2.76 (`DISPUTE_SETTLEMENT_FEE`).
    - PayPal stores the note as evidence `OTHER`, `source: SUBMITTED_BY_SELLER`.
    - The order's refunds also list a `FAILED` USD 62.23 entry, created when PayPal placed the dispute hold (20:15Z). Readback doesn't read refunds.
  - **The ruling comes about two minutes later.** In between, the dispute stays `UNDER_REVIEW` (`dispute_state: UNDER_PAYPAL_REVIEW`), with only a `self` link. At 21:02:13Z PayPal resolved it: `RESOLVED_BUYER_FAVOUR`, reason `SELLER_ISSUED_REFUND`, `amount_refunded` USD 64.99. Fixtures: `07-dispute-after-accept-claim.json`, `07-capture-after-accept-claim.json`, `07-order-after-accept-claim.json`, `07-dispute-resolved-after-refund.json`.
  - **The case view then led with PayPal's ruling:** "PayPal ruled for the buyer. Reason PayPal gives: seller issued refund", then "Readback's evidence agrees", the refund fact, and "nothing left to send."
  - **The fake was out of line here.** It resolved a dispute the moment the claim was accepted. It now follows PayPal's sequence. A retry inside the two-minute window says the charge is already refunded and sends nothing, and the panel says the same.
- **The "my AI bought that" claim files as `UNAUTHORISED` (2026-10-26).** The test used a spare sandbox buyer (not Maya, not the judge account) on a separate agreement, `5ek39697f30423035`. The terms named the production agent key, and one signed charge was made with tracking: order `8J993198BK453370D`, buyer transaction `57H89005FT030084G`, invoice `RB-5ek39697f30423035-P001`. Findings:
  - **The buyer flow.** Report a problem first shows the active automatic payment with Test Store and the USPS tracking ("Report Issue to PayPal" to go on). The list of problems has no plain "I didn't authorize this payment". Under "Unauthorized activity in your PayPal account", it offers three options: "my account is being used by someone else", "lost or stolen card", and **"I suspect the subscription or recurring payment was set up by someone else"**. That option leads to an "Unauthorized access" flow: optionally add more transactions, then a description and Submit.
  - **The first Submit failed** with "something went wrong on our end", and no case was created (checked by API and on the buyer's dashboard). The same steps again succeeded.
  - **The case: `PP-R-QMJ-10194712`, reason `UNAUTHORISED`.**
    - It skipped the inquiry stage: stage `CHARGEBACK`, status `WAITING_FOR_SELLER_RESPONSE`, seller response due Nov 6.
    - Its links offer `accept_claim` (REFUND only) and `provide_evidence`.
    - It holds three evidence requests from the seller: `PROOF_OF_FULFILLMENT`, `PROOF_OF_REFUND` and `OTHER`.
    - It took about 4 minutes to appear in the API's list.
    - Fixtures: `07-unauthorized-dispute.json`, `-capture.json`, `-order.json`.
  - **Readback rebuilt it and classified it as row 12** ("consent unverified", no suggestion), with only check 11 failing: the agreement had no earlier charges. Signature, terms and delivery all passed. With the hero's history, the same claim is row 13, `SELLER_FAVOR`. This answers the go/no-go question for the demo story.
  - **Right after filing, PayPal requires the buyer to secure the account.** It asks her to answer questions and reset the password, and warns: "If you skip this step, your account will be blocked. You won't be able to send, receive or withdraw money." So the hero claim must be filed after the last seed charge it needs, and Maya's password reset is part of filing it.
  - **The buyer's receipt shows the signed mandate (the JWS) as the item description**, as an unreadable string. That should be fixed before the video.
- Not yet done: a dispute that reaches `adjudicate`, and whether the spare buyer stays blocked if the security step is skipped.

**Step 6 (PASS, 2026-10-17).** Run by the daily seed job at 16:00Z; `06-transactions-page1.json` holds the page. All 12 transactions from the last 30 days came back on one page.
- **`:` survives.** Every `rb1:` `custom_field` keeps the full SPEC §4.4 shape, and each one has its `RB-…` `invoice_id`.
- **Lag:** `last_refreshed_datetime` was 14:29:59Z, about 90 minutes behind the request. P002 (charged 10-16 16:00Z) was there; P003 (charged 2 s before the search) was not. History is for prior charges, so the lag doesn't matter to check 11, but a charge made minutes ago won't show up yet.
- **Event codes:** vault charges are `T0003`; the step 1 buyer-present order is `T0006`. The step 7 dispute added a `T1110` hold row and then a `T1111` row, and both carry the disputed charge's `custom_field` and `invoice_id`. History drops the whole `T11xx` family, so a hold doesn't count as a second charge. The code comment that called these refunds was wrong and is fixed.

**Hero agreement (2026-10-15).** Production agent key generated into `apps/agent/.env` (never printed): fingerprint `GAX4 1xq- rZuP w9cM`. Hero agreement `5td85928ph747680n`, 1-day cadence from 2026-10-15, approved as Maya; PayPal's page showed "agent GAX4 1xq- rZuP w9cM", and the terms round-tripped byte-for-byte. The first seed charge (P001) was signed by `apps/agent`, allowed by core's gate, and charged; `@readback/verify` on its capture passes checks 1–9 with no vault echo, and check 10 after tracking. Two findings from that run:
- A vault charge doesn't copy the buyer's address onto the order, so check 10 failed. The gate now sends the agreement's shipping address (accepted and round-tripped; commit 1a08a1e), and `seed:charge` adds a tracker.
- `I` and `l` look identical on PayPal's page (ADR 0002). An earlier hero agreement (`2rn91433te339105w`, key `zSQh…`) was replaced for that reason and revoked the same day (DELETE → 204); its one charge is not used.

## Decision

Go, with the changes above. Steps 1, 2 and 4 pass; step 3's charge passes and its echo fails, with the fallback in place; step 7 (disputes) is the remaining go/no-go.
