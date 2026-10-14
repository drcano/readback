# 0005 — Independent security review, Oct 15 (findings and fixes)

Status: accepted. Reviewer: a fresh Claude Fable 5.1 session that did not write the code, read-only, with proof-of-concept probes. Scope: `readback-core`, the checkout gate and web routes, the agent runtime, and case reading, **as of commit `3a0185a` (Oct 15)**. Not covered: the AP2 import, the browser eval runner, and these fixes themselves; a second scoped review is planned before Nov 1 (CLAUDE.md §7).

Two findings were serious, and both leaned toward the **seller**: exactly what ADR 0004 (neutrality) says must not happen. Both were proven with probes, fixed, and are now regression tests.

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | A payment token with **no** `description` let the merchant's own copy of the terms (with the merchant's key) count as primary → `SELLER_FAVOR` | The order's copy is used only when PayPal's token is gone (then labeled secondary); a token without terms is "no terms" (check 1 fails) | `classify.test.ts` "finding 1" |
| 2 | High | History (check 11) counted any capture **labeled** with the agreement, including charges to the merchant's own wallet → a first charge could reach `SELLER_FAVOR` | Each history capture is verified through PayPal (vault link = this agreement, same payer, completed), oldest first, stopping once two qualify; only verified ones count. Unverified labels still count *against* the merchant (reuse, same-period) | `verify-cli/src/history.test.ts` (with a positive control) |
| 3 | Medium | A failed Transaction Search returned partial history silently; reuse/same-period checks then passed | `historyComplete` in the case bundle; incomplete history makes the case provisional (no seller-favor suggestion) | `classify.test.ts` "finding 3" |
| 4 | Medium | The gate allowed a charge at 00:00:01 after the end date for a request signed at 23:59:58; the investigator then ruled against it | The gate refuses within the clock tolerance of the end, and before the start | `gate.test.ts` "finding 4"; eval "charge would land after the end" |
| 5 | Low | Agreement creation and the demo direct charge weren't rate-limited | Per-instance limits (no customer data) | `budget.test.ts` |
| 6 | Low | Per-IP limits trusted the first `X-Forwarded-For` entry (client-controlled) | Use the proxy-appended last entry | `budget.test.ts` |
| 7 | Low | The case always evaluated `purchase_units[0]` | Evaluate the purchase unit that owns the disputed capture; fail closed if none | `verify-cli/src/bundle.test.ts` |
| 8 | Low | The public case bundle carried shipping addresses | Addresses are replaced by a SHA-256 of their fields; check 10 still compares them, in the browser too | `verify-cli/src/bundle.test.ts` (equal and different addresses) |
| 9 | Low | The brief validator only caught "seller's/buyer's favor" phrasing | Broader outcome wording, tested in both directions | `brief.test.ts` |
| 10 | Low | Webhook verification sends the re-serialized event | Matches PayPal's documented usage; to confirm in the spike (step 5) | — |

Also corrected: THREAT-MODEL T2 claimed the gate counts orders per period. It doesn't (it's stateless); PayPal's duplicate-invoice block does.

**Sound, per the reviewer:** JWS hygiene and pinning, mandate payload rules, action proofs, terms canonical form, money parsing, the gate's ordering (signature before any PayPal call), the vault-echo discipline for the disputed capture, the agent runtime's refusals and key handling, and stores-nothing.
