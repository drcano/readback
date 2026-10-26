# 0006 — Independent review, Oct 25 (findings and fixes)

Status: accepted (2026-10-25). Three independent reviewers (fresh Fable 5.1 sessions that didn't write the code) attacked the engine from three sides: can a dishonest merchant win a case it should lose; can an honest party be hurt or the gate be tricked; is the concept itself sound. Code findings had to be proven with a failing test. Every proof was re-run against the current code before being accepted; all reproduced. The probes are now the regression suite in `evals/audit/` (79 tests).

## Bottom line

- **The money path held.** No way was found to charge outside the approved terms, twice in a period, after revocation, or under the wrong agreement. Forged keys, edited requests, JWS header tricks, non-canonical money and terms, replays and concurrent submissions were all refused.
- **The core invariant held.** In 48 merchant-side attacks, no charge lacking a valid signature by the approved key reached a seller-favor suggestion.
- **The findings were the investigator claiming more than PayPal's records show**, and checks that ruled against honest charges on edge cases. All are fixed below.

## Findings and fixes

| # | Direction | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | Seller-leaning | A duplicate-charge dispute was suggested for the seller as "the single charge in its period", inferred from silence: an unlabeled second charge is invisible to Readback | Row 9 makes no suggestion; PayPal sees every charge to the wallet | `evals/audit/sibling-blindness.test.ts` |
| 2 | Seller-leaning | The history threshold guarded only "unauthorized" disputes; a key swapped in at setup (T21) won first-charge disputes filed under other reasons | The threshold guards every seller-favor row | `evals/audit/reason-skips-history.test.ts`, `classify.test.ts` |
| 3 | Seller-leaning | "Charged before cancellation" had no cancellation record behind it (buyer-side cancel unconfirmed, spike step 5) | Row 10 makes no suggestion until PayPal's cancellation record is readable | `classify.test.ts` |
| 4 | Seller-leaning (wording) | Row 13 said "first-party misuse" and suggested `CUSTOMER_RECOGNIZES_TRANSACTION`, a motive the evidence doesn't show | Row 13 is "signed by her approved agent, within her terms", with `NOT_AN_UNAUTHORIZED_TRANSACTION` only | `classify.test.ts` |
| 5 | Seller-leaning | A capture on the edge of two 31-day search windows counted twice toward history | History keeps each capture once | `evals/audit/findings.test.ts` (F4) |
| 6 | Seller-leaning | Refunded prior charges counted as verified history | Only fully completed priors qualify | `cases.ts`; covered by the history tests |
| 7 | Honest merchant | A tracker PayPal had moved to DELIVERED read as "not shipped" | Check 10 accepts SHIPPED or DELIVERED | `evals/audit/findings.test.ts` (F1) |
| 8 | Honest merchant | Any Transaction Search row carrying the labels counted as a charge: PayPal writes dispute holds (`T1110`/`T1111`, seen live), and declined attempts don't burn the invoice | History keeps payments only (`T00xx`, not denied) | `evals/audit/findings.test.ts` (F3) |
| 9 | Honest merchant | The gate accepted a request up to `exp`, but check 3 allowed only 60 s after it; and a runtime clock 60 s ahead plus PayPal 1 s behind failed check 3 | The gate stops 60 s before `exp`; check 3 allows `iat − 120 s` | `crypto.test.ts`, `evals/audit/findings.test.ts` (F2) |
| 10 | Rule | Signed and order amounts were compared as strings | Integer cents | `checks.ts` |
| 11 | Idempotency | ECDSA signatures have a second valid encoding; request IDs came from the whole JWS, so the twin was a new request at PayPal | Request IDs come from the signed content (`requestHash`); both encodings are one request. The frozen `custom_id` format is unchanged | `evals/audit/malleable-signature.test.ts`, `held.test.ts` |
| 12 | Wording | The agent said "nothing was charged" when the shop didn't answer | It says the outcome is unknown and that asking again is safe | — |
| 13 | Availability | The demo direct charge refused a judge who approved just before UTC midnight | Agreements from today or yesterday | `demo.test.ts` |

## Concept findings (wording, now fixed)

- **Seller-favor rests on an honest setup.** The merchant writes the key binding into the terms at setup, and PayPal doesn't keep the summary the shopper saw (spike step 2). README, SPEC and WHY-PAYPAL now state that precondition wherever they claim a merchant can't fabricate her agent, and that a shopper is never worse off than under a plain billing agreement. PROPOSAL-agent-terms.md is what makes the binding PayPal-attested.
- **"PayPal enforces one charge per period"** now says "while the merchant's duplicate-invoice blocking is on (the default)".
- **Delegation:** an injected in-terms purchase is judged as authorized (T1), consistent with consented payment series.
- **Key custody** is stated as an assumption (T16).
- **Payer match** links "an agreement of this payer", not necessarily this one; it counts for the merchant only with her agent's signature for that agreement (SPEC §3).

## Open, needs the sandbox

- Spike step 5: does a buyer-side cancel delete the token? Row 10 can make a suggestion again only once that is readable.
- Spike step 7: an `UNAUTHORISED` dispute on a hero capture.
- Whether Transaction Search returns `payer_info` for vault charges. If it does, Readback could find unlabeled sibling charges directly and row 9 could rule again.
