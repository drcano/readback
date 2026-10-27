# Why PayPal needs Readback

*The case for Readback, written for PayPal: the problem in PayPal's own words, what the law and the networks already ask for, what exists today, and the questions a skeptical reviewer should ask. Every claim is sourced; things we could not verify are marked.*

Research current as of **October 14, 2026**.

**Readback in one line:** the safe way to let your AI shop with PayPal. The shopper approves her agent's limits once, on PayPal's page; every purchase is signed by her agent; and when anyone says "my AI bought that," the truth takes one click.

---

## The short version

1. **The moment that breaks is "my AI bought that."** PayPal says it evaluates claims on the transaction itself, not on whether a person or an AI initiated it, and that it does not assess AI intent or behavior. When an agent acts without the account holder's authorization, the claim is typically reviewed as an unauthorized payment. [S1] Nothing in that review records what the shopper actually delegated.
2. **The record the law asks for usually doesn't exist.** UK ombudsman decisions have gone against PayPal where a billing agreement existed but PayPal couldn't show the dates and amounts the customer agreed to. [L6, L7] In the US, whether a charge is authorized turns on what authority the consumer gave and when they told PayPal to stop. [L1, L2] In September 2026 a Federal Reserve Governor said the question shifts from proving a buyer is an authorized payer to proving that an agent has the authority to pay. [L10]
3. **PayPal's existing rails can carry that record, including which agent asked.** That means its approval page, billing agreements, merchant-initiated charges, invoice IDs, shipment tracking, and the Disputes API.
   - Readback runs AP2's autonomous-purchase model on those rails. The shopper approves the terms on PayPal's page, including her agent's public-key fingerprint, and every purchase carries a request signed by that agent. [N6]
   - Every field used is confirmed against PayPal's API specifications. Sandbox behavior is recorded publicly in Readback's spike record (`docs/decisions/0001-sandbox-spike.md`); anything the spec still marks [spike] is unconfirmed.
   - Readback adds no new network protocol and no database.
4. **Readback works for the decision-maker, not just the merchant.** Existing dispute tools build the merchant's side of the argument. Readback rebuilds the case from PayPal's own records, verifies the agent's signature, and gives the investigator eleven deterministic checks and a suggested outcome. The suggestion favors the buyer whenever a charge breaks the approved terms or wasn't requested by her agent.
5. **It fits where PayPal says it's going.** CEO Enrique Lores has said trust will be critical in agentic commerce and that PayPal aims to operate in that trust layer. He also said it's "not a technology problem anymore"; what's missing is the right consumer experience. [P1] Readback's experience is explicit, capped, expiring consent on PayPal's own page, with disputes checked against it.

---

## 1. The problem, in PayPal's words

**How PayPal handles it today.** PayPal's April 2026 article on Seller Protection for agentic commerce says three things. [S1]
- Claims are evaluated on the transaction itself, regardless of whether a person or an AI started the purchase.
- PayPal does not assess AI intent or behavior.
- When an agent acts without the account holder's authorization, the claim is typically reviewed as an unauthorized payment.

**What PayPal has proposed.** When PayPal backed AP2 in September 2025, its developer blog listed an opportunity: extend Seller Protection workflows with AP2 mandates, mandate IDs, and signatures as dispute-grade evidence. [P5] We found no public sign that this has shipped. Readback is a working version of that idea on today's rails:
- the open mandate is the terms the shopper approves on PayPal's billing-agreement page, with her agent's key pinned;
- the closed mandates are agent-signed requests carried inside each PayPal order.

**What Agent Ready covers.** Agent Ready says Seller and Purchase Protection, fraud tools, chargeback coverage, and identity services now extend to agentic transactions. [P6] It routes agent purchases into the existing protection processes. It does not add a record of what the shopper delegated.

**What PayPal's leadership is saying.**
- **Q2 2026 earnings call:** Lores said he expects agentic payments and digital identity to become increasingly meaningful contributors. [P2]
- **Goldman Sachs, September 9, 2026:** Lores said trust will be critical, and that PayPal aims to "operate in this trust layer." He also said it's not a technology problem anymore, and that what PayPal hasn't found yet is the right consumer experience. [P1]
- **PayPal's January 2026 protocol essay:** consent and trusted identity are non-negotiable, and agent protocols need to support returns and disputes. [P7]
- **PayPal's developer blog, October 2026:** writing about its internal agent tooling, PayPal says agent actions should stay "attributable to the person who authorized it and the agent that executed it." [P9] Readback applies that principle to agent purchases.

**What PayPal shipped most recently.** PayPal's September 2026 WebMCP support helps merchants become agent-ready, but the shopper is handed to PayPal to review and approve each payment. [P8] That is a human-present flow. Readback covers the human-not-present case: approve once, within limits, and have every purchase checked against that approval.

**The gap, in one sentence:** Agent Ready lets agents pay. Readback lets PayPal prove what they were allowed to pay for, and which agent asked.

---

## 2. What the law and the networks already ask for

None of this is legal advice. It is what the primary sources say, and it explains why Readback records the facts it records.

### United States

| What the law turns on | Source | What Readback records |
|---|---|---|
| A transfer by someone the consumer gave access to is not "unauthorized" unless the consumer has told the institution to stop. | Reg E §1005.2(m)(1) [L1] | Consent given on PayPal's authenticated approval page; revocation as PayPal itself sees it (token deleted, charges refused) |
| If that person exceeds the authority given, the consumer is liable until they notify the institution. | Reg E comment 2(m)-2 [L2] | The exact scope approved: merchant, item, cap, cadence, dates |
| Preauthorized transfers must be authorized in writing, signed or similarly authenticated by the consumer. | Reg E §1005.10(b) [L3] | Approval on PayPal's own logged-in page. PayPal stores the merchant-declared terms at approval time and they can't be edited; the summary shown to her isn't retained (T21) |
| Once notified of a revocation, the institution must block future payments. | Reg E comment 10(c)-2 [L3] | PayPal refuses charges on a cancelled agreement (`AGREEMENT_ALREADY_CANCELLED` at authorize/capture) [A3] |
| Varying amounts need advance notice. The payee or institution may instead offer the consumer a range that could be anticipated. | Reg E §1005.10(d) and comment 10(d)(2)-1 [L3] | The approved cap ("up to $65 per order") can support that kind of range. Readback doesn't claim it satisfies the notice rule on its own |
| Credit-card funding: unauthorized use means use without actual, implied, or apparent authority. | Reg Z §1026.12(b) [L4] | Same record of scope and revocation |

PayPal's own US User Agreement tracks the Reg E rule. If you give someone access and they go beyond what you allowed, you stay responsible until you tell PayPal you no longer authorize their transfers. [L5]

**Status of the debate.** No US agency has said how these rules apply to AI agents.
- Industry and legal commentary in 2026 calls the application "unclear." [L12, L13]
- Fed Governor Waller asked in September 2026 who is on the hook when an agent makes the wrong purchase. He said existing frameworks and consumer-protection standards could potentially be adapted. He also said standards could give everyone a better understanding of what the buyer intended. [L10]
- Senator Warner asked Treasury in June 2026 what protections apply when agents err. [L11]

Readback doesn't depend on how this is settled. Whichever way it lands, the deciding facts are the scope granted and the time of revocation, and Readback records both.

### United Kingdom and EU

**Consent and the burden of proof.**
- Under the Payment Services Regulations 2017, a payment is authorized only if the payer consented to it or to a series it belongs to (reg 67).
- The payment provider must prove authentication, and recorded use of the instrument alone is not necessarily enough (reg 75). [L8]
- Reg 79 gives a refund right, from the payer's provider, for payee-initiated payments where the authorization didn't specify the exact amount and the amount exceeded what the payer could reasonably have expected. [L8]
- PSD2 Art. 64 matches on consent and withdrawal. [L9]

**What the Financial Ombudsman has decided in PayPal cases:**

| Decision | Outcome | What it turned on |
|---|---|---|
| DRN-3436378 (2022) [L6] | Upheld against PayPal | A billing agreement did not make every payment authorized. PayPal needed knowledge of the dates and amounts agreed. |
| DRN-3632811 (2022) [L7] | Upheld against PayPal | Setting up the agreement was not enough on its own. PayPal needed to show consent to the transaction. |
| DRN-5030487 (2024) [L7b] | Not upheld | The customer had consented in advance through an auto-renewal agreement with the merchant. |
| DRN-5833003 (2025) [L7c] | Not upheld | The customer authorized the payment directly at checkout. The billing agreement was not what made it authorized. |

**What the two lost cases show:** PayPal couldn't evidence the specific terms the customer agreed to, and the agreement alone didn't fill that gap. Readback creates that evidence for every purchase made through it: the terms are approved on PayPal's page, and the charge is checked against them.

**What's coming.** HM Treasury's July 2026 consultation asks whether consent and unauthorized-payment liability rules need updating for agentic payments, noting the rules predate AI. [L14] PSD3/PSR is agreed politically but not yet in force. [L15]

### Card networks

- **No liability shift for agent purchases.** Worldpay wrote in July 2026 that no liability shift exists yet for agent transactions. [N1] We found no agent-specific dispute reason code at any network. American Express has announced its own Agent Purchase Protection for cardmembers. [N7]
- **Visa's Compelling Evidence 3.0 already accepts history as proof.**
  - For fraud disputes under reason code 10.4, a merchant can win with two prior undisputed transactions. They must be 120 to 365 days old and match on at least two identity elements, one of which is IP address or device ID. [N2]
  - Visa's April 2026 rules extend CE 3.0 to multi-merchant transactions from October 24, 2026. Secondary sources report that this edition also recognizes login IDs for agentic payment providers. We could not read the rule text directly. [N3]
  - Readback's history check is inspired by CE 3.0 but much weaker: it has no age window and no IP or device match. It is not governed by CE 3.0, since PayPal-wallet disputes are PayPal's own process.
- **Mastercard Verifiable Intent** (March 2026) is an open standard for a tamper-resistant record of what a user authorized, pitched for resolving disputes. It was contributed to the FIDO Alliance alongside AP2 in April 2026, and integration into Mastercard Agent Pay is expected "in the coming months." [N4] It requires new credentials and agent-platform adoption.

---

## 3. What merchants and shoppers say

**Merchants** (PayPal's own Agentic Commerce Pulse research):

| Finding | Source |
|---|---|
| Merchants are split on who should bear agentic dispute liability. Few think the payment provider should. | UK Pulse: 470 merchants, Feb–Mar 2026 [M1] |
| Feeling exposed on liability puts merchants off some agentic use cases entirely. Data security is the top barrier. | UK Pulse [M1] |
| Almost two-thirds of UK merchants say they need agreed rules similar to card dispute rules. | UK Pulse [M1] |
| Large US enterprises on who should be liable for agent disputes: AI platform 46%, the customer who authorized the agent 34%, merchant 11%, shared 5%, payment provider 3%. | US Pulse: 189 large enterprises (of 498 merchants surveyed), fieldwork Feb–Mar 2026 [M2] |

**Shoppers:**
- Commerce and PayPal research (June 2026, 1,000 shoppers each in the US, UK, and Australia) found majority interest in agentic shopping.
- In the UK, the top worry (43%) was an AI buying without approval. [M3]
- Across the three markets, purchase confirmation was the single most important feature. [M3b]
- In separate research by Global Payments (September 2026), 69% would let an agent spend up to $100 on groceries and essentials. [M4] That category is where Readback's demo lives.

**What this means for Readback:**
- Merchants want rules, not a payment provider that absorbs the loss.
- Shoppers want to know the agent can't buy without their say-so.
- A capped, expiring agreement that the shopper approves on PayPal's page, plus a dispute decided against it, gives both groups what they asked for.
- It also keeps PayPal out of the role of default insurer.

---

## 4. The money

From PayPal's FY2025 Form 10-K [F1]:

| Measure | 2024 | 2025 |
|---|---|---|
| Realized losses and charge-offs, protection-program allowance | $1,218M | $1,487M (+22%) |
| Recoveries (negative customer balances) | $164M | $152M |

- **Share of volume:** 2025 realized losses were about 8.3 basis points of TPV ($1.79T) gross, or 7.4 bps net of recoveries. [F1, F2] This covers all protection programs and negative balances, not just unauthorized claims.
- **Total transaction and credit losses:** $1,720M in 2025. [F2]
- **2026 guidance:** transaction losses of about 7.5 bps of TPV. [F3]

**Who pays for a "my AI bought that" claim today:**

| Case | Who pays |
|---|---|
| Unauthorized-transaction claim that is Seller Protection eligible | PayPal |
| Claim that isn't eligible | The merchant |

- Eligibility is shown per charge in `seller_protection` on the capture. [A3]
- PayPal does not charge its standard dispute fee on claims filed as unauthorized, on claims decided in the seller's favor, or on inquiries that aren't escalated. [S2]
- The higher fee applies at a dispute ratio of 1.5% or more, for sellers with more than 100 sales transactions. The ratio counts item-not-received and not-as-described claims. [S2]
- So for this claim type the cost is mostly the payout itself and the time to investigate, not merchant fees.

**What changes with Readback:** every agent charge made through it carries the facts needed to decide it.
- Evidence that a charge was within terms the shopper approved on PayPal supports deciding it isn't unauthorized.
- A charge outside those terms is the merchant's error, and the evidence points there.

We don't claim a dollar figure for losses avoided. PayPal doesn't break out agentic disputes, and no public source reports a dispute rate for agent orders. [N5] The honest claim is narrower and stronger: **this claim type gets a decision rule, and the decision rule doesn't default to PayPal paying.**

---

## 5. What already exists

| Who | What they do for agent disputes | Overlap with Readback |
|---|---|---|
| PayPal Agent Ready [P6] | Extends existing protection programs to agent transactions | Same rails; no record of delegated scope |
| AP2 v0.2, contributed to FIDO [N4, N6] | Open and closed mandates signed as verifiable credentials; human-not-present flows with agent-signed closed mandates | Readback implements this model on PayPal's existing rails, without new credential issuers |
| Mastercard Verifiable Intent [N4] | Open standard for a record of user authorization | Same idea; network-level; Agent Pay integration still expected |
| Amex ACE and Agent Purchase Protection (Apr 2026) [N7] | Agent registration; purchase intent that Amex says it may use for authorization and potentially adjudication | Similar idea, Amex network only |
| Shopify Shop app agents [N8] | Shopper sets "pay without approval" budgets; warns that disputing in-budget purchases may fail | Closest consumer analogue; no adjudication tooling |
| Chargebacks911, Chargeflow, Justt [N9] | Merchant-side representment; Chargebacks911 claims to record agent consent trails | Merchant advocacy, not adjudication |
| Prove Verified Agent, Forter protocol [N10] | Consent and outcome logs for agents | Identity and consent capture outside PayPal |
| Visa Verifi tools, Stripe Smart Disputes [N11] | AI-assisted dispute responses | Not agent-specific |
| "Dispute Autopilot" (this hackathon) [N12] | Seller-side auto-evidence | Merchant advocacy after the fact |

**What we do not claim.**
- Readback is not the first to record what a user authorized, or to have agents sign purchase mandates. AP2, Verifiable Intent, Amex, Prove, Forter, Shopify, and Chargebacks911 all do or plan some of this.
- It is not the first to use prior-purchase history, which is CE 3.0.
- It is not the first to draft dispute responses with AI.

**What is new:**
1. **AP2's autonomous model, running on PayPal rails that exist today.** [N6] AP2 v0.2 requires that an open mandate authorized on a trusted surface carry the agent's public key (`cnf`, an EC P-256 key in AP2's schema), and that each purchase be a closed mandate signed by that key.
   - **Trusted surface:** PayPal's own approval page.
   - **Open mandate:** the stored agreement terms, with the P-256 agent fingerprint pinned.
   - **Closed mandates:** ES256-signed requests stored inside each PayPal order.
   - **Reuse without state:** AP2 handles reuse across purchases with constructs that require tracking previous presentations. Readback reuses one approval across periods statelessly, because PayPal's invoice uniqueness enforces one purchase per period.
   - No agent platform, network, or new credential issuer has to adopt anything.
2. **Once an honest setup has bound her agent's key, a merchant can't fabricate her agent's requests.** The signing key lives only with the shopper's agent, provided the fingerprint she approved is her agent's (T21). A charge with no valid signed request is therefore suggested for the buyer, even if it fits every term. Readback finds that charge through its labels, confirmed by PayPal's record of who paid; PayPal doesn't echo which saved wallet paid (spike step 3), so a merchant who strips both labels and the mandate leaves the charge unlinked from merchant-side data (no suggestion either way). Terms alone can't catch this case, and signatures alone can't decide it without PayPal's records. (Setup-time key substitution is a separate, documented risk; see the hard questions below.)
3. **Terms that can't be edited.** The Vault API has no update operation for payment tokens. [A1] Once the shopper approves, the terms and the agent fingerprint are fixed. Changing them takes a new approval.
4. **PayPal enforces two of the limits itself.**
   - **One charge per period.** Each charge's invoice ID encodes its billing period, so PayPal rejects a second charge in the same period. This invoice-ID uniqueness is on by default but merchant-configurable. [A3] With it off, Readback still flags a later labeled charge in the same period, but a merchant who also strips the labels leaves that charge unlinked (T3).
   - **No charges on a cancelled agreement.** PayPal refuses them. [A3]
   - Cap, item, and dates are enforced by the agent's runtime and by the merchant gate, and re-checked from PayPal's records.
5. **Built for the adjudicator.** The investigator gets three things:
   - eleven deterministic checks over PayPal's records, including signature verification, re-derivable in the browser by anyone with API access to the merchant's account;
   - a scenario classification;
   - a suggested outcome. It favors the buyer whenever a charge breaks the terms or wasn't requested by her agent. It gives **no suggestion** where Readback can't see enough: box contents, delivery beyond a merchant-reported tracker, and consent authenticity without enough history.
6. **Zero data held outside PayPal.** That speaks to merchants' top barrier, data security or privacy [M1]. It also means an investigator never has to trust a third party's database.

---

## 6. Hard questions, answered

**"Isn't this just a billing agreement?"**
The rail is a billing agreement, deliberately. The new parts are what we put on it and what we do with it:
- Agent-specific terms (merchant, item, cap, cadence, dates, and the agent's key fingerprint) written by the shopper in plain English, read back for her approval, and shown on PayPal's page.
- Every charge carries an agent-signed request and is bound to the terms through its invoice ID, reference, and description.
- A shopping agent whose brain (Claude) holds no keys. Its runtime signs only in-terms requests, and the merchant gate charges only valid ones.
- An adjudication workflow that turns "my AI bought that" into a terms-and-signature check.

**"Doesn't Agent Ready already handle disputes?"**
It puts agent purchases into the existing dispute process. That process evaluates the transaction and does not assess what the agent was told. [S1] Readback supplies that missing input.

**"Why not just use AP2 or Verifiable Intent?"**
Readback does use AP2's model: user-approved constraints that pin the agent key, plus agent-signed closed mandates. What it doesn't need is the rest of the ecosystem, which isn't broadly live yet: user-held credentials, issuers, and dispute processes that read SD-JWTs.
- Readback carries the same structure in places PayPal already stores and returns.
- Its agent key uses the key type AP2's schema requires (EC P-256). Its mandates are a compact JWS rather than SD-JWT.
- It imports a real AP2 v0.2 open Payment Mandate and runs the same constraint checks against it, mapping AP2's own constraint types (`amount_range`, `allowed_payees`, `execution_date`, `agent_recurrence`) (it shipped: `/ap2`).
- When AP2 adoption arrives, the checks are the same constraint evaluation AP2 describes.

**"Which agent bought it?"**
The one whose public-key fingerprint the shopper approved on PayPal's page. Every purchase carries a mandate signed by that key, and the investigator re-verifies it in the browser.
- What this proves: the request came from her agent, not from the merchant or anyone else.
- What it doesn't prove: who built or operates the agent. That is agent-provider attestation, which networks such as Visa (Trusted Agent Protocol) and Mastercard (Agent Pay) are working on.

**"What if the shopper's account was taken over, and the attacker approved the agreement?"**
Then the consent itself is fraudulent. In US terms, access obtained through fraud is not "furnished" by the consumer. [L2] Readback can't see login and device risk signals; PayPal can. A valid agent signature doesn't help here, because whoever approved the agreement chose the key. Readback classifies unauthorized claims below a stated history threshold as "consent authenticity unverified" and hands them to PayPal's account-takeover process. It never rules on them.

**"The merchant runs Readback. Why trust it?"**
You don't have to.
- The terms and the agent fingerprint come from the payment token, which the merchant can't edit.
- Charges, invoice IDs, trackers, and disputes come from PayPal's APIs.
- The merchant can't forge the agent's signature, because the key lives only on the shopper's side, provided the fingerprint she approved is her agent's (T21).
- The evidence file is a convenience. Its JSON appendix lists every PayPal object ID and the signed mandates, so anyone with API access to the merchant's account can re-derive every check.
- A merchant who charges the saved wallet directly and bypasses the gate is linked to the agreement through the labels it left plus PayPal's record of who paid. With no valid signed request, the suggestion favors the buyer. If it strips both labels and the mandate, the charge is unlinked from merchant-side data and Readback makes no suggestion either way (spike step 3, T3).
- Where only merchant-written data is available (for example, terms read from charge copies after the shopper deletes the agreement), Readback labels it and withholds any seller-favor suggestion.
- **What remains, stated honestly:**
  - In this build, the investigator page is served by the merchant's deployment, so results are re-derivable but not independent. PayPal hosting it would make it independent.
  - A dishonest merchant's shopper page could insert its own key fingerprint at setup. Code can't stop that here. The shopper's defense is comparing the fingerprint her own agent shows her with the one on PayPal's page. That page shows only the merchant-supplied plan name, not the stored terms (sandbox spike, step 2), so a lying merchant could show her fingerprint and store its own. In production, PayPal would show the stored terms or fetch the agent key itself. (Threat model T21.)

**"What can a dishonest merchant still fake?"**
What ships. The SKU on an order and on a tracker is merchant-reported, which is true of every PayPal transaction today. Readback shows that the charged SKU matches both the approved SKU and the SKU the agent signed. It cannot prove what was in the box. Not-as-described claims stay with PayPal's normal process.

**"Under Reg E, if an agent exceeds its authority the consumer may still be liable. Why does Readback recommend a refund for an over-cap charge?"**
Three reasons:
1. An over-cap charge on a merchant-initiated agreement is the merchant charging more than the shopper approved. That is an incorrect-amount problem on the merchant's side, not an agent going rogue with the shopper's credentials.
2. UK law gives a refund right for payee-initiated payments above what the payer could reasonably expect. [L8]
3. A tool that sides with the shopper whenever the terms were broken is one shoppers and regulators can trust.

This is a policy choice, stated as one.

**"What about wallets funded by a credit card?"**
A PayPal outcome doesn't bind the card issuer. The shopper can still go to their bank. Readback's record is the same evidence PayPal would use to respond to that chargeback. Agent Ready says chargeback coverage extends to agentic transactions, but we haven't confirmed the terms. [P6]

**"Does this handle an agent that shops across many merchants?"**
Not today. One agreement covers one merchant, which fits replenishment, subscriptions, and standing orders.
- Each merchant would get its own agreement under the same consent pattern.
- A cross-merchant mandate is what AP2's open mandates are for.
- The build imports and checks AP2 open mandates (`/ap2`). Cross-merchant enforcement is roadmap.

**"Is a merchant-initiated charge on a vaulted wallet even Seller Protection eligible?"**
We found no PayPal document that says either way. Readback doesn't assert it. It shows PayPal's own `seller_protection` status from each capture. [A3]

---

## 7. Who adopts it, and what PayPal would get

**Who adopts it:**
- **Merchants adopt it now.** It wins the disputes they should win, and it's only believed because it recommends refunds for the ones they should lose.
- **Shoppers get a hard limit.** Their agent can't spend outside what they approved on PayPal, and a merchant can't charge in their agent's name without a signature by the key bound at setup (an honest setup is the precondition, T21). A shopper is never worse off than under a plain billing agreement: the most a dishonest adopter gains is charging without her agent asking, bounded by the cap and the cadence.
- **PayPal is the natural long-term owner.**

**From the hackathon build:**
- A working reference implementation on the public APIs, with a public record of every sandbox call it depends on.
- `@readback/core`, packaged for npm (published at submission): the typed, browser-safe checks library.
- `@readback/verify` (`npx @readback/verify` once published at submission): re-derives a case from PayPal using the merchant account's API credentials (or PayPal's own). It removes dependence on the merchant's hosted code, not on API access to that account.
- A change to PayPal's Agent Toolkit, prepared as patches in `docs/toolkit-pr` (a pull request once our GitHub account is restored), adding `verify_agent_purchase` and `provide_dispute_evidence`, and fixing two `accept_dispute_claim` bugs. The toolkit's dispute tools today are list, get, and accept; there is no evidence submission. [A4]
- A 10-line quick-start for existing PayPal merchants.

**For production**, the same checks run better inside PayPal. Internally PayPal has three things the merchant-side build can't see:
- The deleted-token history, so it can see the terms even after the shopper cancels.
- The approval session's authentication and risk signals, so it can separate account takeover from first-party misuse.
- The full charge history without the reporting delay.

**The roadmap: one API change.** `docs/PROPOSAL-agent-terms.md` sketches an `agent_terms` object on Vault payment tokens, written as an OpenAPI diff against the public spec.
- PayPal fetches the agent's key itself and shows it on the approval page.
- PayPal retains the terms after cancellation.
- PayPal verifies each charge's signed mandate and records the result on the capture.

That closes the remaining gaps (setup-time key swap, terms after revocation, unsigned direct charges) and turns the eleven checks into PayPal-side checks with the same definitions.

---

## 8. Limitations, stated plainly

- **Sandbox-only demo.** The hosted demo runs on PayPal's sandbox. Every ruling shown is PayPal's own: the sandbox's `require-evidence` and `adjudicate` endpoints refused every state we tried (spike step 7), so rulings come from PayPal resolving a case itself or after the store refunds.
- **Investigator view is a concept.** It is a proposed workflow running on merchant credentials, not an integration with PayPal's internal tools. The web view's results are re-derivable, not independent of the merchant's deployment. The `@readback/verify` CLI removes the dependence on merchant-hosted code, but still needs API access to the merchant's account. Only PayPal hosting the view would make it fully independent.
- **Judge mode holds a demo key in the browser.** To show that the signer isn't the builder, judge mode lets a judge's own browser hold a non-extractable agent key for one session. It's a demonstration, not a production key-custody design (threat model T31).
- **Demo cadence.** The live demo uses one-day periods, labeled on screen, so that history exists before the deadline. Disputes are hand-opened in the sandbox. Judge mode makes live sandbox charges under the judge's own agreement and checks them in preview mode; it doesn't open disputes.
- **Terms after revocation.** If a shopper deletes the agreement, the merchant-side API can no longer read the token. Readback then falls back to the copy of the terms carried on every charge, labels it secondary, and withholds any seller-favor suggestion based on it. PayPal internally would not have this gap.
- **Spike-dependent behavior.** These are tested in the spike (`docs/decisions/0001-sandbox-spike.md`), and the design has a fallback for each if it doesn't hold:
  - whether PayPal's order shows which saved wallet paid (it doesn't; the fallback is in place);
  - what PayPal's approval page displays (only the plan name, which now carries the fingerprint);
  - merchant-initiated charges on the saved wallet;
  - duplicate-invoice blocking;
  - whether unauthorized disputes open as inquiries;
  - what happens when the buyer cancels from their side.
- **Reporting delay.** Charge history comes from Transaction Search, which can lag up to three hours. [A5] This affects history checks only. Duplicate-period protection is enforced by PayPal at charge time, while the merchant's duplicate-invoice blocking is on.
- **Agent identity proves "which agent," not "whose agent."** Signatures prove that a purchase came from the agent key the shopper approved. They don't attest who built or operates that agent. A key swap at setup is stopped only by the shopper comparing fingerprints (threat model T21).
- **Demo-grade agent access.** The shopper's agent runtime is protected by a secret connector URL in the demo; production would use OAuth.
- **Signed mandates are a compact JWS (ES256), not AP2's SD-JWT verifiable credentials.** The open mandate is authenticated by PayPal's approval rather than a user signature.
- **Our evals are our own scenarios.** Property-based tamper fuzzing and published fixtures let anyone challenge them.
- **No dollar claim.** We don't estimate losses avoided.

---

## Sources

**PayPal statements and products**
- [S1] PayPal, "How PayPal's Seller Protection is evolving for the agentic commerce era," Apr 30, 2026. https://www.paypal.com/us/brc/article/seller-protection-agentic-commerce
- [S2] PayPal US User Agreement (updated Sep 14, 2026), dispute fee terms; PayPal business fees page (updated Oct 1, 2026). https://www.paypal.com/us/legalhub/paypal/useragreement-full · https://www.paypal.com/us/business/paypal-business-fees
- [P1] Enrique Lores, Goldman Sachs Communacopia + Technology Conference, Sep 9, 2026 (transcript). https://www.investing.com/news/transcripts/paypal-at-goldman-sachs-communacopia--technology-conference-reset-deepens-93CH-4894720
- [P2] PayPal Q2 2026 earnings call transcript, Jul 28, 2026. https://s205.q4cdn.com/875401827/files/doc_financials/2026/q2/PYPL-2Q-26-Earnings-Transcript.pdf
- [P5] PayPal Developer blog, "PayPal and the Agent Payments Protocol," Sep 16, 2025. https://developer.paypal.com/community/blog/PayPal-Agent-Payments-Protocol/
- [P6] PayPal, AI Agent Ready. https://www.paypal.ai/us/agent-ready
- [P7] PayPal Newsroom, "Making Sense of the AI Shopping Protocol Moment," Jan 21, 2026. https://newsroom.paypal-corp.com/2026-01-22-Making-Sense-of-the-AI-Shopping-Protocol-Moment
- [P8] PayPal Developer blog, "WebMCP is here: PayPal is helping every merchant become agent-ready," Sep 16, 2026. https://developer.paypal.com/community/blog/WebMCP_PayPal_Agent_Ready
- [P9] PayPal Developer blog, "One connection. 2,000 tools," Oct 8, 2026. https://developer.paypal.com/community/blog/One_connection_2000_tools

**PayPal research**
- [M1] PayPal UK Agentic Commerce Pulse (Stripe Partners, 470 merchants, Apr 2026). https://www.paypalobjects.com/marketing/Agentic%20Pulse%20UK%20Report.pdf · https://www.paypal.com/uk/brc/article/agentic-commerce-pulse-report-findings
- [M2] PayPal US Agentic Commerce Pulse, large enterprise report (498 merchants, Mar 2026). https://www.paypalobjects.com/marketing/web26/us/agentic-commerce-pulse-report/paypal-agentic-commerce-report_le-report.pdf
- [M3] Commerce and PayPal consumer research, Jun 23, 2026. https://www.globenewswire.com/news-release/2026/06/23/3315902/0/en/64-of-uk-consumers-want-to-use-agentic-ai-for-shopping-according-to-new-research-from-commerce-and-paypal.html
- [M3b] Commerce, three-market release on the same research, Jun 2026. https://commerce.gcs-web.com/news-releases/news-release-details/two-thirds-consumers-are-ready-try-agentic-shopping-many-demand
- [M4] Global Payments consumer survey, Sep 2026 (via Chain Store Age). https://chainstoreage.com/survey-consumers-would-let-ai-agents-spend-them-these-categories

**PayPal financials**
- [F1] PayPal FY2025 Form 10-K, allowance for transaction losses and negative customer balances. https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/R114.htm
- [F2] PayPal Q4 2025 earnings release (TPV, transaction and credit losses). https://s205.q4cdn.com/875401827/files/doc_financials/2025/q4/PYPL-4Q-25-Earnings-Release.pdf
- [F3] PayPal Q4 2025 earnings call transcript, Feb 3, 2026 (2026 transaction-loss outlook). https://s205.q4cdn.com/875401827/files/doc_financials/2025/q4/PayPal-4Q-25-Earnings-Transcript.pdf

**Law and policy**
- [L1] 12 CFR 1005.2(m). https://www.consumerfinance.gov/rules-policy/regulations/1005/2/
- [L2] Reg E Official Interpretation, comments 2(m)-2 and 2(m)-3. https://www.consumerfinance.gov/rules-policy/regulations/1005/interp-2/
- [L3] 12 CFR 1005.10 and Official Interpretation. https://www.consumerfinance.gov/rules-policy/regulations/1005/10/ · https://www.consumerfinance.gov/rules-policy/regulations/1005/interp-10/
- [L4] 12 CFR 1026.12(b) and commentary. https://www.consumerfinance.gov/rules-policy/regulations/1026/12/
- [L5] PayPal US User Agreement, unauthorized transactions. https://www.paypal.com/us/legalhub/paypal/useragreement-full
- [L6] Financial Ombudsman Service, DRN-3436378. https://www.financial-ombudsman.org.uk/decision/DRN-3436378.pdf
- [L7] Financial Ombudsman Service, DRN-3632811. https://www.financial-ombudsman.org.uk/decision/DRN-3632811.pdf
- [L7b] Financial Ombudsman Service, DRN-5030487. https://www.financial-ombudsman.org.uk/decision/DRN-5030487.pdf
- [L7c] Financial Ombudsman Service, DRN-5833003. https://www.financial-ombudsman.org.uk/decision/DRN-5833003.pdf
- [L8] Payment Services Regulations 2017, regs 67, 75, 76, 77, 79. https://www.legislation.gov.uk/uksi/2017/752/regulation/67 (and /75, /76, /77, /79)
- [L9] PSD2 (Directive 2015/2366) Art. 64. https://www.legislation.gov.uk/eudr/2015/2366/article/64
- [L10] Governor Christopher Waller, "Payments in the Age of AI Agents," Sibos, Sep 29, 2026. https://www.federalreserve.gov/newsevents/speech/files/waller20260929a.pdf
- [L11] Sen. Mark Warner, letter to Treasury Secretary Bessent, Jun 2, 2026. https://punchbowl.news/wp-content/uploads/260602.Warner_Bessent_Banks_AI_agents.FINAL_.SIGN_.pdf
- [L12] Consumer Bankers Association, Agentic Symposium white paper, Jan 22, 2026. https://consumerbankers.com/wp-content/uploads/2026/01/CBA-Agentic-Symposium-White-Paper-2026-01.pdf
- [L13] Fenwick, "Is 2026 the Year of Agentic Payments?" Apr 22, 2026. https://www.fenwick.com/insights/publications/is-2026-the-year-of-agentic-payments
- [L14] HM Treasury, "Modernising Payment Services Regulation" consultation, Jul 14, 2026. https://www.gov.uk/government/consultations/modernising-payment-services-regulation/modernising-payment-services-regulation-consultation
- [L15] PSD3/PSR readiness tracker. https://www.openbankingtracker.com/guides/psd3-psr-readiness

**Networks and market**
- [N1] Worldpay, "Agentic commerce liability is still being written," Jul 30, 2026. https://www.worldpay.com/en/insights/articles/agentic-commerce-liability-is-still-being-written
- [N2] Visa, Compelling Evidence 3.0 merchant readiness, Mar 2023. https://usa.review.visa.com/content/dam/VCOM/regional/na/us/support-legal/documents/compelling-evidence-3.0-merchant-readiness-mar2023.pdf
- [N3] Visa Core Rules, Apr 18, 2026 edition, Summary of Changes (https://usa.visa.com/dam/VCOM/download/about-visa/visa-rules-public.pdf); agentic login-ID reading per Pulse, Sep 24, 2026 (https://pulsecrm.com/blog/visa-compelling-evidence-3-multi-merchant-change-october-2026/). *Rule text not read directly.*
- [N4] Mastercard, Verifiable Intent, Mar 5, 2026 (https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html); FIDO Alliance announcement, Apr 28, 2026 (https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/)
- [N5] Chargeflow, agent chargeback liability (states that no public source reports a dispute rate for agent orders). https://www.chargeflow.io/blog/ai-agent-chargeback-liability
- [N6] AP2 specification v0.2, autonomous (human-not-present) mode: open mandates must carry the agent's public key as a `cnf` claim; closed mandates are signed by the agent key. https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md
- [N7] Digital Commerce 360 on American Express ACE Developer Kit, Apr 14, 2026. https://www.digitalcommerce360.com/2026/04/14/american-express-agentic-commerce-developer-kit-purchase-protection/
- [N8] Shop app help, personal agents. https://help.shop.app/en/shop/shopping/personal-agents
- [N9] The Paypers on Chargebacks911, May 2026 (https://thepaypers.com/fraud-and-fincrime/news/chargebacks911-warns-of-dispute-risk-gap-in-agentic-payments); Chargeflow evidence playbook (https://www.chargeflow.io/blog/agentic-commerce-chargebacks-the-evidence-playbook-merchants-need); Justt (https://justt.ai/blog/solving-agentic-commerce-chargebacks/)
- [N10] Prove Verified Agent (https://www.prove.com/blog/prove-verified-agent-secure-agentic-commerce); Forter agentic commerce (https://www.forter.com/agentic-commerce/)
- [N11] Digital Commerce 360 on Visa dispute tools, Apr 1, 2026 (https://www.digitalcommerce360.com/2026/04/01/visa-adds-ai-tools-for-dispute-resolution/); Stripe Sessions 2026 (https://stripe.com/blog/everything-we-announced-at-sessions-2026)
- [N12] Dispute Autopilot. https://github.com/Ejicode/dispute-autopilot

**PayPal APIs**
- [A1] PayPal REST API specifications, Payment Method Tokens v3. https://github.com/paypal/paypal-rest-api-specifications (`openapi/vault_payment_tokens_v3.json`)
- [A3] Orders v2, Payments v2, and Orders error reference. https://github.com/paypal/paypal-rest-api-specifications · https://developer.paypal.com/api/rest/reference/orders/v2/errors/
- [A4] PayPal Agent Toolkit, v1.11.0 (Sep 1, 2026). https://github.com/paypal/agent-toolkit
- [A5] PayPal Transaction Search. https://developer.paypal.com/docs/transaction-search/
