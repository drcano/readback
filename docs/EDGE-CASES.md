# Edge cases

What Readback does at every boundary we know of, from approval on PayPal to PayPal's ruling, and the proof for each.

This page covers **honest parties at the edges**: clocks, limits, retries, PayPal's own states and outages, and load. Attacks by a dishonest merchant, agent or web page are in [THREAT-MODEL.md](THREAT-MODEL.md) (T1–T34) and in the attack lab at `/judge`.

## Proof tiers

Every row says how it is known:
- **Test:** an automated test over the in-memory PayPal fake, or over pure `readback-core`. It is cited as file › test name, and all of them run in `pnpm test`.
- **Sandbox:** observed against PayPal's sandbox. Each observation is recorded in the [spike record](decisions/0001-sandbox-spike.md), with the scrubbed response in `evals/fixtures/spike/`.
- **Runbook:** not automated. These are operating rules, each with its reason (§8).

Some tests in `evals/audit/findings.test.ts` are named for the bug they pin. Each one asserts the fixed, honest outcome.

**Test status, Oct 26:**
- `pnpm test`: 389 tests pass (core 155, verify 5, agent 16, evals 152, web 61).
- `node e2e/run.ts` in `apps/web`: 24 checks pass in Chromium (the judge flow, plus axe on 8 pages in light and dark).

## 1. Approval on PayPal

| Edge | What Readback does | Proof |
|---|---|---|
| The judge cancels on PayPal's page | The popup returns through Readback's return route and tells the judge's tab, which says "You cancelled on PayPal." Nothing is set up. | Test: [agreements](../apps/web/lib/agreements.test.ts) › "judge mode's cancel goes back through the return route, so the opener tab hears about it"; [e2e](../apps/web/e2e/judge.e2e.ts) › "step 1 cancelled: the popup reported back and nothing was set up" |
| Terms outside the grammar (unknown item, cap, cadence, dates) | Refused before PayPal is called. | Test: [agreements](../apps/web/lib/agreements.test.ts) › "refuses unknown items and terms outside the grammar's limits"; [setup](../packages/readback-core/src/setup.test.ts) › "refuses what PayPal's plan display can't express" |
| A currency other than USD | Refused, in the terms and in a signed request. | Test: [terms](../packages/readback-core/src/terms.test.ts) › "other currency"; [crypto](../packages/readback-core/src/crypto.test.ts) › "other currency" |
| The longest terms the grammar allows | Fit PayPal's fields: the terms in 127 characters, and the plan name PayPal shows in its 127 allowed characters. One character more is refused. | Test: [terms](../packages/readback-core/src/terms.test.ts) › "the worst case under the limits fits in 127 chars"; [setup](../packages/readback-core/src/setup.test.ts) › "worst-case plan name stays within 127 allowed characters"; [held](../evals/audit/held.test.ts) › "terms at the 125-char worst case parse; 128 chars don't" |
| A fingerprint PayPal's page can't show, or shows ambiguously (`_` refused in plan names; `I` and `l` look identical in PayPal's font) | Agent keys are redrawn until the fingerprint has neither ([ADR 0002](decisions/0002-fingerprint-display.md)). | Test: [crypto](../packages/readback-core/src/crypto.test.ts) › "never contain _ (refused in plan names) or I/l (identical in PayPal's font)" |
| Which agreement shapes PayPal accepts | Of five shapes tried, PayPal accepts only `RECURRING_PREPAID` with a `VARIABLE` plan. The terms in `description` round-trip byte for byte; `billing_plan` is not returned. | Sandbox: [step 2](decisions/0001-sandbox-spike.md) (`02-payment-token-get.json`) |

## 2. Signing and the checkout gate

| Edge | What Readback does | Proof |
|---|---|---|
| Exactly at the cap; quantity at the limit | Allowed. One cent or one unit more is refused. | Test: [crypto](../packages/readback-core/src/crypto.test.ts) › "allows exactly the cap"; [held](../evals/audit/held.test.ts) › "cap equal to price passes; qty×unit over cap fails; qty over limit fails"; [scenarios](../evals/scenarios.ts) › "price exactly at the cap" · "quantity at the limit" |
| The first second of the agreement | Allowed. Start is inclusive from 00:00:00 UTC; end is inclusive through 23:59:59. | Test: [terms](../packages/readback-core/src/terms.test.ts) › "start is inclusive from 00:00:00, end inclusive through 23:59:59"; [scenarios](../evals/scenarios.ts) › "first second of the agreement" |
| The last minute of the agreement, or before it starts | Refused, so a request can't be signed in terms and charged after the end. | Test: [gate](../packages/readback-core/src/gate.test.ts) › "audit finding 4: no charge in the last minute of the agreement, or before it starts"; [held](../evals/audit/held.test.ts) › "the gate refuses to charge within 60 s of the end date and before the start" |
| Signed at 23:59:58, charged after midnight | It belongs to the period it was signed in; the invoice stays canonical and every check passes. | Test: [terms](../packages/readback-core/src/terms.test.ts) › "handles the 1-day demo cadence boundary (signed 23:59:58 stays in its period)"; [held](../evals/audit/held.test.ts) › "signed at 23:59:59 on day 1, charged at 00:00:30 on day 2: period 1, canonical invoice, all checks pass"; [scenarios](../evals/scenarios.ts) › "signed 23:59:58, charged 00:00:01 (period of signing)" |
| Periods longer than a day | The period is derived from the signing time and must match. | Test: [held](../evals/audit/held.test.ts) › "periodDays > 1: p is derived from iat and must match" |
| The agent's clock runs fast, or PayPal is slow near expiry | A request may be signed up to 60 s in the future. The gate stops charging 60 s before the request expires, so PayPal's latency can't push an honest charge outside check 3's window. | Test: [crypto](../packages/readback-core/src/crypto.test.ts) › "freshness: iat up to 60s ahead; the gate stops one skew before exp (audit Oct 25)"; [findings](../evals/audit/findings.test.ts) › "the gate stops one skew before exp, so 120 s of PayPal latency and skew still passes check 3"; [scenarios](../evals/scenarios.ts) › "two minutes before expiry" |
| A request lifetime other than 300 s | Refused, as are expired and future-dated requests. | Test: [held](../evals/audit/held.test.ts) › "exp−iat must be exactly within 300 s; expired and future requests are refused" |
| Money written non-canonically (`64.990`, a quantity of `01`) | Refused, never coerced. Money is integer cents; every cent value round-trips. | Test: [money](../packages/readback-core/src/money.test.ts) › "refuses non-canonical or out-of-range amounts (fail closed)" · "round-trips every cent value"; [held-up](../evals/audit/held-up.test.ts) › "amount strings in non-canonical form (64.990)" · "quantity written as '01'" |
| The shopper asks twice in one period | The agent signs (it's in terms); PayPal refuses the duplicate invoice, and the shopper sees "already ordered this period." | Test: [tab-agent](../apps/web/lib/tab-agent.test.ts) › "a second order in the period is signed, then refused by PayPal"; [checkout](../apps/web/lib/checkout.test.ts) › "a second request in the same period is refused by PayPal's duplicate-invoice block". Sandbox: [step 4](decisions/0001-sandbox-spike.md) (`04-duplicate-response.json`) |
| The same signed request is submitted twice, or at the same moment | One order. The `PayPal-Request-Id` is derived from the request, so PayPal replays the first answer. | Test: [checkout](../apps/web/lib/checkout.test.ts) › "a resubmitted identical mandate is a no-op at PayPal (same request ID, same order)"; [held](../evals/audit/held.test.ts) › "the same mandate twice (sequential or concurrent) yields one order; a second mandate in the period is refused by PayPal". Sandbox: [step 4](decisions/0001-sandbox-spike.md) (`04-idempotent-replay.json`) |
| The same signature re-encoded (ECDSA allows a second valid encoding) | Same request ID, so PayPal replays the first order instead of making a second. | Test: [held](../evals/audit/held.test.ts) › "the twin verifies with a different mandateHash but the same request ID, so PayPal replays the first order"; [malleable-signature](../evals/audit/malleable-signature.test.ts) › "a flipped-s copy of a genuine mandate verifies with a different mandateHash but the same request IDs" |
| The payment is declined | Nothing is charged and the shopper gets a plain denial. The invoice ID isn't used up, so a later retry can succeed. | Test: [held](../evals/audit/held.test.ts) › "PayPal declining the create leaves nothing charged and maps to a denial". Sandbox: [step 4](decisions/0001-sandbox-spike.md) (`04-mock-decline-response.json`, `04-retry-after-decline.json`) |
| The order create is dropped mid-flight | Retried once with the same request ID; PayPal makes one order. | Test: [checkout](../apps/web/lib/checkout.test.ts) › "a dropped order create is retried once with the same request ID, and PayPal makes one order" |
| PayPal is still unreachable after the retry | A plain-language denial: "PayPal didn't answer in time. Asking again is safe: PayPal refuses a second charge this period." Nothing is charged. | Test: [checkout](../apps/web/lib/checkout.test.ts) › "PayPal still unreachable after the retry is a plain-language denial, not a crash" |
| PayPal answers in a shape Readback doesn't expect | A denial, not a crash. | Test: [checkout](../apps/web/lib/checkout.test.ts) › "an unexpected shape from PayPal is a denial, not a crash" |
| Reading the agreement fails | A 404 means the agreement isn't active. A 403 or 500 returns an error (502), and nothing is charged. | Test: [held](../evals/audit/held.test.ts) › "404 token → AGREEMENT_NOT_ACTIVE; 403/500 on the token GET → 502 and nothing charged" |
| The agreement was cancelled | Refused. The sandbox answers a deleted token with `403 PERMISSION_DENIED`, which maps to "agreement not active." | Test: [checkout](../apps/web/lib/checkout.test.ts) › "a cancelled agreement is refused"; [gate](../packages/readback-core/src/gate.test.ts) › "maps PayPal refusals to plain-language denials". Sandbox: [step 5](decisions/0001-sandbox-spike.md) (`05-merchant-charge-after-revoke.json`) |
| A vault charge doesn't copy the buyer's address onto the order | The gate ships to the address she approved on the agreement, so check 10 can compare. | Test: [gate](../packages/readback-core/src/gate.test.ts) › "ships to the address she approved on the agreement (a vault charge doesn't copy it)". Sandbox: hero agreement, [spike record](decisions/0001-sandbox-spike.md) |
| A 619-character signed request in the item description | Round-trips byte for byte, before and after capture. A vault charge completes on create, with no capture call. | Sandbox: [steps 1 and 3](decisions/0001-sandbox-spike.md) (`01-order-get-after-capture.json`, `03-order-get.json`) |

## 3. The agent, set up wrong

| Edge | What Readback does | Proof |
|---|---|---|
| The agreement's terms name a different key than the agent's (a setup mistake, or a key swap) | The agent refuses to operate under them (T21). | Test: [agent](../apps/agent/src/agent.test.ts) › "refuses terms that carry someone else's fingerprint (key swap at setup, T21)"; [tab-agent](../apps/web/lib/tab-agent.test.ts) › "refuses to act under terms that name another key (T21)" |
| The terms can't be read | Refused. | Test: [agent](../apps/agent/src/agent.test.ts) › "refuses unreadable terms" |
| The private key in the environment is missing, not JSON, or on the wrong curve | The runtime refuses to start, without echoing the value. | Test: [agent](../apps/agent/src/agent.test.ts) › "refuses missing, non-JSON, or wrong-curve keys without echoing the value" |
| An MCP path secret is too short | The runtime refuses to start. | Test: [runtime](../apps/agent/src/runtime.test.ts) › "refuses short path secrets at startup" |
| A tool call names an agreement other than the one its path serves | Refused (T33). | Test: [runtime](../apps/agent/src/runtime.test.ts) › "refuses other agreements on a path, and terms carrying another key (T21, T33)" |

## 4. Claude unavailable or wrong

Nothing that decides money or a ruling depends on Claude, so each of these has a designed fallback.

| Edge | What Readback does | Proof |
|---|---|---|
| No Anthropic key, or Claude is down | The chat shows a designed "not connected" state; the rest of the demo works. | Test: [e2e](../apps/web/e2e/judge.e2e.ts) › "ask Claude to shop: unlocked after approval; no key → designed state" |
| The day's Claude budget is used up | Same: a plain message, and the rest works (T34). | Test: [budget](../apps/web/lib/budget.test.ts) › "limits per key per hour and per day, and resets the next day" |
| Claude keeps calling tools | Stopped after a bounded number of turns. | Test: [agent-chat](../apps/web/lib/agent-chat.test.ts) › "stops after a bounded number of tool turns" |
| The brief makes a claim without a citation, invents one, or reaches an outcome the rules didn't | Rejected and retried once with the validator's feedback. If it still fails, the rules-only brief is shown. | Test: [brief](../apps/web/lib/brief.test.ts) › "rejects uncited sentences, invented citations, and outcomes the rules didn't reach" · "retries once with the validator's feedback, then falls back to the rules brief" |
| The terms Claude drafts are slightly off | Refused, not quietly fixed; a refusal or unparseable output becomes a plain error. | Test: [terms-compiler](../apps/web/lib/terms-compiler.test.ts) › "refuses rather than fixes anything off in Claude's proposal" · "a refusal or unparseable output becomes a plain-language error" |
| "Ask the queue" without Claude | Falls back to keyword matching. | Test: [queue-filters](../apps/web/lib/queue-filters.test.ts) › "falls back to keywords without Claude" |

## 5. Building a case from PayPal's records

| Edge | What Readback does | Proof |
|---|---|---|
| The disputed capture shows `PENDING`, reason `BUYER_COMPLAINT` (how PayPal shows a charge under dispute) | Counted as completed. A capture pending for any other reason fails check 4. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "hero, as PayPal really shows a disputed capture (PENDING, BUYER_COMPLAINT) → still SELLER_FAVOR" · "a capture pending for any other reason didn't complete → check 4 fails" |
| The charge was refunded or partly refunded; the dispute is a card issuer's chargeback; one dispute covers several charges | The case says so: a refund note; "the issuer decides, and PayPal's outcome doesn't bind it"; links to the other charges. None of these changes the suggestion. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "states refunds, card-issuer chargebacks and multi-charge disputes without changing the suggestion (Oct 26)"; [held](../evals/audit/held.test.ts) › "a PARTIALLY_REFUNDED or dispute-held capture still counts as completed" |
| An order with several purchase units | Evaluates the unit that owns the disputed capture. It fails closed if the order doesn't contain it. | Test: [bundle](../packages/verify-cli/src/bundle.test.ts) › "evaluates the purchase unit that owns the disputed capture (finding 7)" · "fails closed when the order doesn't contain the capture" |
| PayPal sends no vault echo on the order | The agreement comes from the order's labels, accepted only with PayPal's payer match. If PayPal ever sends an echo, the echo wins. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "row 1: the agreement was approved by a different PayPal account" · "an echo, when PayPal sends one, links the charge even if the token is gone". Sandbox: [step 3](decisions/0001-sandbox-spike.md) (`03-order-get.json`) |
| The agreement has since been deleted | The terms come from the order's copy, marked secondary, so there is no suggestion. A secondary copy never rescues a buyer-favor result. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "agreement deleted → secondary terms → no suggestion" · "secondary terms never rescue a buyer-favor result". Sandbox: [step 5](decisions/0001-sandbox-spike.md) (token GET returns 404 after delete; `05-merchant-token-after.json`) |
| The charge is under 3 hours old | Provisional, no suggestion: Transaction Search lags. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "under 3 hours old → provisional → no suggestion". Sandbox: [step 6](decisions/0001-sandbox-spike.md) (about 90 minutes of lag) |
| A new agreement with little history (fewer than 2 earlier undisputed charges, or the earliest under 7 days old) | No suggestion: consent authenticity is unverified. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "row 12: not enough history → consent authenticity unverified" · "row 12: history too recent (earliest under 7 days)" · "a judge's fresh charge has no history yet → no suggestion"; [e2e](../apps/web/e2e/judge.e2e.ts) › "step 4: own charge in preview has no suggestion yet" |
| Earlier charges that were themselves disputed | Don't count as history. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "row 12: prior charges that were themselves disputed don't count" |
| Holds, reversals and denied rows in Transaction Search (`T11xx`, `T12xx`, status `D`) | Not counted as charges, so a dispute hold never looks like a second payment. | Test: [findings](../evals/audit/findings.test.ts) › "findHistory passes through T12xx rows and status D rows unfiltered". Sandbox: [step 6](decisions/0001-sandbox-spike.md) (`T1110`, `T1111` rows; `06-transactions-page1.json`) |
| A charge exactly on the seam of two 31-day search windows | Counted once. | Test: [findings](../evals/audit/findings.test.ts) › "a capture at exactly start+31d is counted as two verified priors, so check 11 passes with ONE real prior" |
| The history search is incomplete (rate limit, error, or Readback's own call budget) | Provisional. The case says why, and never suggests the seller. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "finding 3: an incomplete history search makes the case provisional (no seller-favor suggestion)"; [flood](../evals/flood.test.ts) › "one case when every earlier charge is disputed: 65 PayPal calls → at most 20 (bounded history walk)" |
| "Not received", and the order has a shipment | Row 6: the shipment is merchant-reported, so no suggestion. It stays so once PayPal marks it delivered. | Test: [findings](../evals/audit/findings.test.ts) › "NOT_RECEIVED dispute on a delivered order should be row 6 (shipment reported), not BUYER_FAVOR" · "the hero UNAUTHORISED case stays SELLER_FAVOR once PayPal marks it delivered"; [classify](../packages/readback-core/src/classify.test.ts) › "rows 5/6: not received, with and without a tracker" |
| A "duplicate" claim, and this is the only labeled charge in its period | No suggestion: an unlabeled twin would be invisible to merchant-side data. | Test: [scenarios](../evals/scenarios.ts) › "neither: 'duplicate', and it's the only labeled charge in its period"; [sibling-blindness](../evals/audit/sibling-blindness.test.ts) › "an unlabeled twin charge can't make the labeled copy look like the only one (row 9 makes no suggestion)" |
| A "cancelled recurring" claim, and the cancellation time can't be read | No suggestion. | Test: [scenarios](../evals/scenarios.ts) › "neither: 'cancelled recurring', and the cancellation time isn't readable" |
| A dispute reason Readback doesn't cover | No suggestion. | Test: [classify](../packages/readback-core/src/classify.test.ts) › "row 0: out-of-scope reasons get no suggestion" |
| Shopper addresses in the case bundle | Hashed, and check 10 still compares them. | Test: [bundle](../packages/verify-cli/src/bundle.test.ts) › "hashes addresses but still lets check 10 compare them (finding 8)" |
| PayPal changes a capture's shape | The bundle parse fails; it never counts against the merchant. | Test: [held](../evals/audit/held.test.ts) › "a capture with an unexpected PayPal shape fails the bundle parse, not the merchant" |

## 6. Answering PayPal, and PayPal's ruling

| Edge | What Readback does | Proof |
|---|---|---|
| PayPal offers different actions in different states (under review: supporting info only; inquiry: evidence, message, offer, accept, escalate) | Follows the dispute's own links. An action PayPal doesn't offer is refused, naming what it does offer. | Test: [actions](../apps/web/lib/actions.test.ts) › "refuses an action the dispute's links don't offer, naming what PayPal does offer". Sandbox: [step 7](decisions/0001-sandbox-spike.md) (`PP-R-BVW-10191531`, `PP-R-CFY-10194687`) |
| Sending Readback's evidence | The server rebuilds the case from PayPal at send time (no text from the browser) and sends it as evidence or supporting info, whichever PayPal offers. It then reads the dispute back to confirm. | Test: [actions](../apps/web/lib/actions.test.ts) › "rebuilds the case from PayPal, sends the statement as supporting info, and finds it on the dispute". Sandbox: [step 7](decisions/0001-sandbox-spike.md) (stored as `PROOF_OF_FULFILLMENT`, `SUBMITTED_BY_SELLER`; `07-dispute-after-readback-evidence.json`) |
| A resend after PayPal has the evidence (PayPal then stops offering `provide_evidence`) | The record is checked before the links: "already on PayPal's record," nothing sent. | Test: [actions](../apps/web/lib/actions.test.ts) › "doesn't resend text already on the case". Sandbox: [step 7](decisions/0001-sandbox-spike.md) |
| Ten sends at once on one dispute | One statement on PayPal's record. | Test: [flood](../evals/flood.test.ts) › "ten concurrent evidence sends on one dispute leave exactly one statement" |
| The store refunds instead of contesting | Accepts the claim with a full refund and a note written by code from the case. PayPal refunds at once and keeps the note as seller evidence. The dispute stays under review, with no actions, for about two minutes, then closes for the buyer. A retry in that window says the charge is already refunded; a retry after says PayPal resolved it. Neither sends anything. | Test: [actions](../apps/web/lib/actions.test.ts) › "accepts the claim with a full refund, explains why in a note written by code, and only once"; [labels](../apps/web/lib/labels.test.ts) › "reads PayPal's real ruling after the store refunded (sandbox, Oct 26)". Sandbox: [step 7](decisions/0001-sandbox-spike.md) (`07-dispute-after-accept-claim.json`, `07-dispute-resolved-after-refund.json`) |
| A write action without the store's admin token | Refused (401). The panel's buttons stay disabled until a token is entered, and the server checks it. | Test: [evals](../evals/evals.test.ts) › "guard: merchant action without admin token" |
| Nobody answers, and PayPal rules alone (the sandbox did, about 14 hours after filing) | The case view leads with PayPal's ruling and says whether Readback's evidence agrees. | Test: [labels](../apps/web/lib/labels.test.ts) › "leads with PayPal's ruling and says whether Readback's evidence agrees" · "is null while the dispute is open". Sandbox: [step 7](decisions/0001-sandbox-spike.md) (`07-dispute-resolved.json`) |
| Resolved without a ruling, or Readback has no recommendation | Claims no agreement either way. | Test: [labels](../apps/web/lib/labels.test.ts) › "claims nothing when Readback has no recommendation or PayPal's outcome isn't a ruling" |

## 7. Load and PayPal's limits

All measured against Readback's own stack over the PayPal fake, never against the sandbox. Numbers are before → after the Oct 26 changes.

| Edge | What Readback does | Proof |
|---|---|---|
| A case where every earlier charge is disputed | The history walk is bounded: 65 PayPal calls became 16, and the test caps it at 20. The case says history isn't established instead of claiming there is none. | Test: [flood](../evals/flood.test.ts) › "one case when every earlier charge is disputed: 65 PayPal calls → at most 20 (bounded history walk)" |
| PayPal rate-limits while the queue loads | Every listed dispute still appears (14 of 60 → all 50 listed). The ones not loaded say why and carry no verdict. With more than 50 disputes, a notice says PayPal has more. | Test: [flood](../evals/flood.test.ts) › "rate limited mid-build: every listed dispute still appears (14/60 → all), unloaded ones without a verdict" |
| PayPal is slow | The queue stops at its time budget and lists the rest as not loaded. | Test: [flood](../evals/flood.test.ts) › "slow PayPal: the queue stops at its time budget and lists the rest as not loaded" |
| A flood of forged webhooks | A header prefilter drops them with no PayPal calls (1,000 → 0); a genuine-looking one is still verified with PayPal. | Test: [flood](../evals/flood.test.ts) › "1,000 forged webhooks cost no PayPal calls (1,000 → 0); a genuine-looking one still gets verified"; [webhooks](../apps/web/lib/webhooks.test.ts) › "drops a spoofed event PayPal doesn't verify" · "drops events with missing headers, bad JSON, or no webhook ID configured, without calling PayPal" |
| Several judges behind one office IP | Per-IP hourly limits are sized for shared IPs; the daily caps are the cost control. | Test: [budget](../apps/web/lib/budget.test.ts) › "limits per key per hour and per day, and resets the next day" |
| A client-supplied `X-Forwarded-For` | Ignored. The limit keys on the entry Render's proxy appended. | Test: [budget](../apps/web/lib/budget.test.ts) › "uses the proxy-appended (last) X-Forwarded-For entry, not a client-supplied first one" |

## 8. Runbook: operating edges

| Edge | Rule | Why |
|---|---|---|
| Filing an unauthorized claim makes the buyer secure her account, or the account is blocked | File the hero dispute only after the last seed charge it needs, and have Maya complete the password reset when PayPal asks. File other unauthorized disputes on separate agreements. | Observed on `PP-R-QMJ-10194712` ([spike record](decisions/0001-sandbox-spike.md), step 7): "If you skip this step, your account will be blocked." A blocked buyer would stop the seed charges. |
| The buyer's unauthorized option is "I suspect the subscription or recurring payment was set up by someone else" | Use that option for the hero claim. It files as `UNAUTHORISED` and skips the inquiry stage. The first Submit may fail with "something went wrong"; retry once. | Step 7, Oct 26. |
| The demo direct charge is one per agreement (`RB-<token>-DIRECT`) | Make the hero's twist charge and open its dispute close to the Nov 8 recording. Expect judges (Dec 1–15) to see it resolved: the case view leads with PayPal's ruling and says whether Readback agrees (§6). | PayPal's duplicate-invoice guard allows that invoice ID once, and unanswered sandbox disputes resolve in about 14 hours. |
| Unanswered sandbox disputes resolve on their own after about 14 hours | Open the demo's disputes close to recording. The case view is built to show resolved cases (§6). | Observed on `PP-R-BVW-10191531` (step 7). |
| A new dispute takes a few minutes to appear in PayPal's list, and about two minutes to get its action links | The queue may not show it yet; the case view by ID reads it at once. Wait for the links before sending. | Step 7 observations. |
| Transaction Search lags about 90 minutes (PayPal says up to 3 hours) | A charge made minutes ago shows the Agent light as Caution, never Fail; check 11 uses earlier charges only. | Step 6, and the e2e check "your two verdicts". |
| The hero `SELLER_FAVOR` case needs 2 or more earlier undisputed charges, the earliest at least 7 days before | The daily seed job keeps the history growing. | Check 11's threshold. |
| Rate limits are per instance | Run one instance of each service. | With more instances the effective limits multiply (THREAT-MODEL T25). |

## 9. Not covered yet

Known and unproven. None of these is claimed anywhere else.
- **Popup and exchange states:** the popup-blocked fallback link and the failed-exchange message reach the judge's tab, but no automated test exercises them.
- **Buyer-side cancel:** cancelling in PayPal's settings, and whether that fires `VAULT.PAYMENT-TOKEN.DELETED`, is pending (spike step 5).
- **Adjudication:** no dispute has yet reached PayPal's adjudication after Readback's evidence. (The unauthorized claim itself is now tested: it files as `UNAUTHORISED`, in the chargeback stage, spike step 7.)
- **Long statements:** an evidence statement over PayPal's 2,000-character limit is cut with an ellipsis. No test builds one that long.
