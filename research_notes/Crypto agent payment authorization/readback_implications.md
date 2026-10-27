# Crypto and agent-payment authorization: what it means for Readback

*Research as of Oct 26–27, 2026. About 21 web searches and fetches. Primary sources are marked; most coverage of this space is vendor blogs or aggregators (eco.com, nevermined.ai, fintechspecs, digitalapplied), labeled "secondary" below. Readback context was read from `CLAUDE.md` §1–2, `docs/WHY-PAYPAL.md` (§5–6), and `docs/PROPOSAL-agent-terms.md`, whose headline finding is that PayPal deletes the agreement's payment token within about 3–30 minutes of an UNAUTHORISED claim, measured twice in the sandbox on Oct 26–27.*

## Which products and standards record user intent or agent authorization for purchases, and how?

### Takeaway
Only Mastercard Verifiable Intent (VI) and AP2 have the same structure as Readback: user-approved constraints that pin an agent key, plus agent-signed per-purchase records. Both are network or protocol drafts. VI v0.1 defines neither revocation nor a dispute procedure. Everything else on the list is either a scoped token (a cap and an expiry, with no record of what the user said or which agent asked) or a crypto spend-limit wallet (enforced limits, final settlement, and no adjudication). On revocation, crypto delegations are better than Readback today: revoking them doesn't erase the original grant, while PayPal deletes the agreement.

### Cited Findings

**Comparison (the "consent record" in each product, who holds it, whether it survives, and whether it's bound to an agent key)**

| Product | Consent record | Who holds it | Survives revocation or dispute? | Bound to a specific agent key? |
|---|---|---|---|---|
| **Readback** (for reference) | Terms plus agent fingerprint in the PayPal payment token `description`; per-purchase ES256 JWS in the order | PayPal | **No.** The token is deleted on cancel, and within minutes of an UNAUTHORISED claim (PROPOSAL headline). Fallback: merchant-written copies, labeled secondary | Yes (RFC 7638 thumbprint in terms) |
| **Mastercard VI v0.1** | L1: an issuer-signed identity key. L2: user-signed constraints with the agent's key in `cnf`. L3a/L3b: agent-signed payment and checkout records | User or agent present the SD-JWT chain; network enforces | No revocation protocol defined; short lifetimes only (L2 autonomous lasts 24h–30 days) | Yes (`cnf`) |
| **AP2 v0.2** | Open and closed mandates; human-not-present mode with agent-signed closed mandates | Holder-presented VCs | Not verified in this pass | Yes (`cnf`, EC P-256) |
| **Stripe Shared Payment Token** | `usage_limits` (currency, max_amount, expires_at) scoped to one seller profile | Stripe | Revocable (`/revoke`, `deactivated` webhook); no terms record to survive | **No** |
| **Visa Trusted Agent Protocol** | RFC 9421 HTTP signatures by a registered agent | Agent registry | No intent record defined | Agent key, but not tied to a user grant |
| **Skyfire KYAPay** | `pay+JWT` carrying the committed amount; `aud` binds it to a seller | Skyfire issues | `exp` only; no revocation and no disputes | Agent account (`sub`), not a user-approved key |
| **Coinbase Agentic Wallets** | Server-side policy (per-transaction and session caps, allowlists) | Coinbase (MPC plus Nitro enclave) | Session revocable by master signer; no refunds or disputes | Session key |
| **MetaMask delegations (ERC-7710/7715) + GenLayer** | User-signed delegation with on-chain caveats (token, recipient, budget, merchant, expiry) | On-chain | Revocation by a controller; doesn't reverse settled payments | Yes (delegate address) |

Sources for each row follow.

**Mastercard Verifiable Intent**
- Announced by Mastercard with Google on Mar 5, 2026, as an open standard for a tamper-resistant record of what a consumer authorized an agent to do, aimed at disputes — [PYMNTS](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/); [The Paypers](https://thepaypers.com/payments/news/mastercard-introduces-verifiable-intent-co-developed-with-google)
- Integration into Agent Pay's intent APIs was expected "in the coming months," with API specs and developer tools still to follow — [The Paypers](https://thepaypers.com/payments/news/mastercard-introduces-verifiable-intent-co-developed-with-google)
- Spec details, from a **secondary** technical write-up (Mar 6, 2026, corrected Mar 8) and not from the spec itself:
  - Draft v0.1, Apache-2.0, ES256.
  - Layers: L1 (issuer, about 1 year), L2 (user-signed constraints; about 15 minutes in immediate mode, 24h–30 days in autonomous mode), L3a/L3b (agent-signed, about 5 minutes).
  - The L2 `cnf` names the agent key, so "only that agent can generate L3 credentials."
  - Constraints are enforced "at the network level, not at the agent level"; budget and recurrence require network state.
  - No revocation mechanism is described, and the spec "does not define dispute procedures."
  - — [Shane Deconinck](https://shanedeconinck.be/posts/mastercard-verifiable-intent-agents-can-prove-what-you-approved/)
- Mastercard's developer guide said Agent Pay was in pilot (AWS, Highnote), with GA targeted for June 2026 — [Mastercard Developers](https://developer.mastercard.com/merchant-cloud/documentation/tutorials-and-guides/agentic-commerce-guide/21/). GA was not confirmed in this pass.
- The latest dated adoption signal found: on Sep 17, 2026, Alchemy's AgentCard announced support for Mastercard Agent Pay credentials, "designed to support" VI (**secondary**) — [fintechspecs](https://fintechspecs.com/blog/mastercard-alchemy-agentcard-agent-pay-verifiable-intent/)

**AP2 / FIDO**
- On Apr 28, 2026, FIDO formed Agentic Authentication and Payments technical working groups; Google donated AP2, and Mastercard contributed VI — [FIDO Alliance](https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/); [PPC Land](https://ppc.land/fido-alliance-forms-working-groups-to-lock-down-ai-agent-payments/)
- AP2 is still pre-1.0; v0.2 added human-not-present mode — [RisingWave explainer (secondary)](https://risingwave.com/blog/agent-payments-protocol-ap2-explained/)
- No post-April FIDO specification release was found (search result summary, same sources).

**Stripe ACP / Shared Payment Tokens** (**primary**: Stripe docs, API version `2026-09-30.preview`)
- The agent creates a `SharedPaymentIssuedToken` from the customer's PaymentMethod for one seller's `network_business_profile`, with `usage_limits[currency|max_amount|expires_at]`.
- It can be revoked at any time. The `deactivated` state is terminal ("consumed, expired, or revoked").
- Stripe may use Mastercard Agent Pay and Visa Intelligent Commerce network tokens on the merchant's behalf.
- Nothing binds the token to an agent key, and nothing records the user's instruction.
- — [Stripe docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent)
- A fintech analysis argues that SPTs protect credentials but do little to protect merchants from intent disputes; settlement and disputes stay merchant-side (**secondary**) — [Fintech Wrap Up](https://www.fintechwrapup.com/p/deep-dive-the-hidden-liability-of)

**Visa Trusted Agent Protocol / Intelligent Commerce**
- The reference repo's agent produces "RFC 9421 compliant signatures" bound to the merchant domain and operation, verified against an "Agent Registry" of public keys.
- Consumer identifiers are shared "as consented by the consumer," but no intent or authorization record is defined.
- Dispute use is not specified beyond reducing fraud and chargebacks.
- The repo shows no release date, 6 commits, and © 2026.
- — [github.com/visa/trusted-agent-protocol](https://github.com/visa/trusted-agent-protocol)
- TAP was announced Oct 14, 2025 — [Finextra](https://www.finextra.com/newsarticle/46901/visa-builds-trust-protocol-for-agentic-commerce). Sources disagree on whether it is now part of Visa Intelligent Commerce or a separate product (**secondary**: [eco.com](https://eco.com/support/en/articles/15192003-mastercard-agent-pay-vs-visa-trusted-agent-2026-compared)).
- On Jun 10, 2026, Visa and OpenAI announced tokenized Visa credentials for agent checkout in ChatGPT and Codex, with spending limits enforced before authorization (**secondary**) — [Digital Applied](https://www.digitalapplied.com/blog/visa-openai-tokenized-agentic-commerce-payments-merchant-guide)

**Skyfire KYAPay** (**primary** whitepaper, dated Jun 26, 2025; 16 months old)
- Token types are `kya+JWT`, `pay+JWT`, and `kya+pay+JWT`, signed ES256 and verified via JWKS.
- The pay token contains "the payment value that the buyer has committed to pay." `aud` gives "audience binding, prevents replay."
- The `aid` agent-identity claim is empty in the example.
- Revocation and disputes aren't covered; `exp` is the only lifecycle control.
- — [kyapay.org/whitepaper](https://kyapay.org/whitepaper)

**Coinbase Agentic Wallets** (launched Feb 11, 2026; **secondary**, page dated Sep 16, 2026)
- A server-side policy engine checks per-transaction caps, session caps, and allowlists before an AWS Nitro Enclave signs. Keys are MPC-split and "never leave the enclave."
- A master signer can revoke a session. Refunds and disputes aren't covered.
- x402 had about 69k active agents, 165M transactions, and about $50M cumulative volume (Apr 21, 2026 figures).
- — [eco.com](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)

**MetaMask delegations + GenLayer "Internet Court"** (**primary**, MetaMask, Sep 25, 2026)
- The user signs one Smart Account delegation scoped by token, recipient, budget, merchant, and expiry. The agent redeems it repeatedly without a per-payment owner signature.
- Out-of-scope x402 payments are blocked before the facilitator settles.
- For in-scope but questionable payments, a five-validator AI jury reviews "the user's mandate against transaction data and signed evidence." It can continue, constrain, or revoke future authority. It "does not reverse a payment that has already settled" unless an escrow is used.
- Neither flow has a published transaction hash or case ID yet.
- — [MetaMask](https://metamask.io/news/genlayer-internet-court-ai-agent-jury)
- ERC-7715 `wallet_grantPermissions` gives a time-bounded, capped delegation enforced on-chain (**secondary**) — [eco.com](https://eco.com/support/en/articles/10714103-what-is-erc-7715-smart-wallet-permissions-explained)

**Others**
- **Catena Labs**:
  - Raised a $30M Series A (a16z crypto, Acrew) on May 20, 2026.
  - Its OCC national trust bank charter application was accepted for filing, not approved.
  - The product is described as spending caps, approved recipients, and audit trails, with no technical description of how authorization is recorded.
  - — [The Block](https://www.theblock.co/news/deals/2026-05-20-catena-labs-lands-30-million-series-a-files-for-national-trust-bank-charter-to-underpin-agentic-finance-402029)
- **Payman**:
  - Selected for the ICBA ThinkTECH accelerator on May 20, 2026: AI that runs transactions on a bank's rails with "policy controls, approvals, and audit trails" — [VentureBeat](https://venturebeat.com/business/payman-ai-selected-for-icba-thinktech-accelerator)
  - Funded agent wallet with daily and per-transaction caps (**secondary**, Mar 2026) — [Dupple](https://dupple.com/reviews/payman)
- **Nekuda**: $5M seed (May 2025; Madrona, Amex Ventures, Visa Ventures) built around "agentic mandates" with purchase limits and approval rules (**secondary**) — [Proxy](https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026)
- **Natural**: $9.8M seed for B2B agent payment workflows (**commentary**) — [TenOneTen](https://www.tenoneten.com/latest/money-at-machine-speed)
- **Kite AI**: $33M for an agent-payments blockchain (**commentary**) — [TenOneTen](https://www.tenoneten.com/latest/money-at-machine-speed)
- **Nevermined**: virtual card delegation with spend limits, time windows, and MCC rules, plus a 1% stablecoin fee (**vendor blog**) — [Nevermined](https://nevermined.ai/blog/agentic-payments-in-2026-the-infrastructure-guide-for-platforms)
- **Crossmint**: smart-contract agent wallets with network-level guardrails (**aggregator**) — [fintechspecs](https://fintechspecs.com/blog/best-ai-agent-payment-infrastructure-providers/)
- Skyfire, Crossmint, and Basis Theory are in the Agentic Commerce Consortium (Sep 2025) — [Proxy](https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026)

### Inferences
- The field splits three ways:
  - **intent-record standards** (VI, AP2), which match Readback's structure but are drafts and leave adjudication to networks;
  - **scoped credentials** (SPT, KYAPay, network agent tokens, TAP), which answer "was this agent allowed to present this credential" but not "what did the user ask for";
  - **programmable wallets** (Coinbase, ERC-7715, Crossmint, Catena), which enforce limits hard but settle irreversibly.
- Readback is the only one found that rebuilds a dispute from the processor's own records, and the only one on PayPal rails.
- VI is Readback's closest twin. Readback's terms-plus-fingerprint maps to VI L2 with `cnf`, and its per-order JWS maps to L3. The honest differences:
  - VI's L2 is **user-signed**. Readback's open mandate is authenticated only by PayPal's approval, and PayPal doesn't show the stored terms (T21).
  - VI constraints are **network-enforced**. Readback's cap, item, and dates are enforced by the agent runtime and the merchant gate; PayPal enforces only period uniqueness and refuses charges on a cancelled agreement.
- On durability, every crypto delegation keeps the original grant (on-chain, or in the user's SD-JWT). Readback's grant lives only in PayPal, which deletes it on an unauthorized claim. That is Readback's biggest structural weakness, and its strongest proposal argument.
- Coinbase's design (a policy check in front of an enclave signer) is a stronger key-custody story than Readback's runtime, a plain service holding `AGENT_PRIVATE_KEY` in env.

### Gaps
- VI details come from a secondary write-up. verifiableintent.dev and the GitHub spec were not fetched, so whether a v0.2 or later added revocation or credential status is unknown.
- AP2's revocation semantics weren't re-checked against the spec this pass.
- Mastercard Agent Pay GA (targeted June 2026) and any live VI issuers weren't confirmed.
- **Nekuda, Natural, Kite AI, Nevermined, Crossmint, Halliday:** only funding or aggregator mentions were found. A targeted Nekuda search returned nothing relevant, and **nothing at all was found on Halliday**. Their consent-record designs are unknown; don't attribute features to them.
- No PayPal or PYUSD agent-mandate product was found as of October 2026. PayPal's crypto lead called PYUSD "a very natural programmable layer" at Consensus Miami on May 10, 2026 — [CoinDesk](https://www.coindesk.com/business/2026/05/10/agentic-commerce-will-run-on-crypto-rails-paypal-and-google-reps-tell-consensus-miami).

## Does anything already do what Readback does on PayPal rails, and is WHY-PAYPAL §5 outdated or missing anything?

### Takeaway
No product found signs per-purchase mandates on PayPal rails and rebuilds disputes from PayPal's records. The closest functional analogue is GenLayer's AI jury, which judges in-scope payments against a mandate, but it runs on-chain, can't reverse settlement, and has published no cases. §5 isn't wrong, but it's missing Stripe SPT, Visa TAP, Coinbase Agentic Wallets, and the MetaMask/GenLayer jury. The VI row should also say that v0.1 defines no revocation and no dispute procedure.

### Cited Findings
- VI provides evidence but "does not define dispute procedures"; liability, chargebacks, and arbitration remain network-specific — [Shane Deconinck](https://shanedeconinck.be/posts/mastercard-verifiable-intent-agents-can-prove-what-you-approved/)
- Worldpay (Jul 30, 2026): liability and dispute resolution for agent transactions are "still being written" (already WHY-PAYPAL [N1]) — [Worldpay](https://www.worldpay.com/en/insights/articles/agentic-commerce-liability-is-still-being-written)
- GenLayer's jury reviews a mandate against signed evidence, but does not reverse settled payments, and has no published case IDs (Sep 25, 2026) — [MetaMask](https://metamask.io/news/genlayer-internet-court-ai-agent-jury)
- Stripe SPT is scoped and revocable, with no agent key or intent record — [Stripe docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent)
- Visa TAP defines agent signatures and a registry, but no intent record or dispute use — [Visa GitHub](https://github.com/visa/trusted-agent-protocol)
- Coinbase Agentic Wallets enforce policy before enclave signing, with no disputes — [eco.com (secondary)](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)
- PayPal is listed among AP2 partners (60+) — [nohacks (secondary)](https://nohacks.co/blog/agent-payments-protocol-60-organizations)

**Suggested §5 edits (dated):**
1. **Add Stripe ACP/SPT** (`2026-09-30.preview`): a seller-scoped cap and expiry, revocable, with no record of the user's instruction or the agent's key.
2. **Add Visa TAP** (announced Oct 14, 2025): agent identity by RFC 9421 signature, no intent record. WHY-PAYPAL §6 mentions TAP only for "who operates the agent." That's correct; it just isn't in the table.
3. **Add Coinbase Agentic Wallets** (Feb 11, 2026) and **MetaMask/ERC-7715 + GenLayer** (Sep 25, 2026), as the crypto counterparts: enforced limits, final settlement; GenLayer is the only other mandate-vs-transaction adjudicator found.
4. **Amend the VI row:** "v0.1: user-signed constraints with agent `cnf` key; network-enforced; no revocation protocol and no dispute procedure defined; Agent Pay integration still pending; Alchemy AgentCard support announced Sep 17, 2026."
5. Optionally, a **Catena Labs** row (charter filed May 2026, not approved), as the regulated-fiduciary route.

### Inferences
- §5's "What is new" claim 1 ("AP2's autonomous model, running on PayPal rails that exist today") still holds: nothing found contradicts it.
- §5 can now make a sharper, sourced contrast. VI has the structure but leaves adjudication undefined; GenLayer adjudicates but can't reverse; Readback adjudicates on a rail that can reverse (PayPal refunds and dispute outcomes).
- One honest admission belongs next to that contrast: PayPal deletes the consent record on the very claim Readback adjudicates. On-chain delegations don't have that problem.

### Gaps
- **Not re-verified in this pass:** Amex ACE and Agent Purchase Protection, Shopify Shop agents, Chargebacks911, Chargeflow, Justt, Prove Verified Agent, Forter, Visa Verifi, Stripe Smart Disputes, and Dispute Autopilot. Their §5 rows rest on WHY-PAYPAL's Oct 14 research and weren't re-checked here.
- A search summary referenced an August 2026 analysis saying neither Visa nor Mastercard has a binding chargeback rule for agent disputes. The specific article wasn't identified or fetched, so treat it as unverified. Worldpay (above) supports the weaker claim that liability is unsettled.
- No PayPal-native competitor (another hackathon entry or a PayPal product) was searched for beyond what WHY-PAYPAL already lists.

## Which ideas from crypto are worth borrowing, and at what cost?

### Takeaway
Three ideas fit Readback's "stores nothing" rule and directly answer the PayPal-deletes-the-agreement finding:
1. a **user-held, user-signed copy of the open mandate**;
2. a **hash of the approved terms anchored in a public log**;
3. **revocation recorded as a timestamped event**, not as deletion.

Each adds a dependency or changes the demo story. The best hackathon fit is idea 1, and Dante must approve it before it's built.

### Cited Findings
- **User-signed open mandate (VI L2 / AP2).** In VI, the user signs L2 constraints that include the agent's `cnf` key; each layer carries an `sd_hash` of the previous one, so the chain is self-contained evidence held by the presenter — [Shane Deconinck](https://shanedeconinck.be/posts/mastercard-verifiable-intent-agents-can-prove-what-you-approved/)
- **Off-chain attestation with an on-chain hash (EAS):**
  - Off-chain attestations can be anchored on-chain to timestamp them, "allowing others to see what and when was attested to."
  - Private Data attestations post only a Merkle root hash.
  - Attestations use EIP-712 signatures and carry a revocable flag.
  - — [QuickNode EAS guide](https://quicknode.com/guides/ethereum-development/smart-contracts/what-is-ethereum-attestation-service-and-how-to-use-it). No gas or cost figures were found.
- **Revocation as an on-chain event:**
  - ERC-7715/7710 delegations are revoked or constrained through an on-chain controller, while the original signed delegation persists — [MetaMask](https://metamask.io/news/genlayer-internet-court-ai-agent-jury)
  - Short expiries bound a leaked key's blast radius (a 24h permission, for example) — [eco.com (secondary)](https://eco.com/support/en/articles/10714103-what-is-erc-7715-smart-wallet-permissions-explained)
- **Why the timing of revocation matters legally.** Under Reg E, a transfer by an authorized person isn't "unauthorized" until the consumer tells the institution to stop, and the institution must then block future payments (WHY-PAYPAL §2) — [12 CFR 1005.2(m)](https://www.consumerfinance.gov/rules-policy/regulations/1005/2/); [12 CFR 1005.10 interp.](https://www.consumerfinance.gov/rules-policy/regulations/1005/interp-10/)
- **Policy-before-signer custody (Coinbase):** a policy engine checks every request before a Nitro enclave signs — [eco.com (secondary)](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)

### Inferences

**Idea 1: a shopper-held signed receipt of the approval.** At approval, Maya's agent runtime (which already holds a P-256 key) signs `{termsHash, tokenId, approved_at}`, and that receipt is handed to Maya (a download or her runtime config). It's client-held, which CLAUDE.md §5 already allows ("client-held identifiers").
- After PayPal deletes the token, the receipt plus the per-order copies let an investigator confirm that the merchant's copy matches what her own agent attested.
- It would let Readback upgrade, not drop, the "secondary" label on post-deletion terms.
- **Cost:**
  - It's signed by the *agent*, not the user, so it proves her agent saw those terms, not that she approved them. It's weaker than VI's user-signed L2.
  - A dishonest merchant still controls the setup page (T21).
  - It changes the demo story, so Dante must approve.

**Idea 2: anchor `termsHash` in a public log** (EAS on an L2 chain, or a non-crypto transparency log such as Sigstore Rekor).
- The log proves the terms existed at time T, independently of PayPal. Only a hash is posted, so no personal data goes on-chain.
- **Cost:**
  - It's a new external dependency, and on-chain gas (not quantified here).
  - The hash is public and linkable: anyone holding the terms can confirm Maya's agreement existed.
  - It sits awkwardly with "PayPal is the only system of record," and it's not on the stack list.
  - It doesn't prove *who* approved.
  - Better pitched as a line in the PayPal proposal ("or retain a hash") than built for the hackathon.

**Idea 3: revocation as an event, not a deletion.** This is already the PROPOSAL's `deleted_at` field. Crypto delegations show the pattern working in production: the grant stays and the revocation is a separate timestamped fact. Cite that as precedent in PROPOSAL-agent-terms.md. No build cost.

**Idea 4 (custody):** a policy check in front of the signer is what Readback's runtime already does in code (it signs only constraint-passing requests). The gap is the enclave. Name it as a production upgrade in the limitations; don't build it.

### Gaps
- No source quantifies EAS or L2 anchoring costs as of Oct 2026.
- No source was found on a processor (card or PayPal) retaining consent records after a dispute, beyond Readback's own sandbox measurement.
- Whether user-held receipts would be accepted as evidence in PayPal's dispute process is unknown.

## What are the threats to Readback's pitch, and the one-sentence answers?

### Takeaway
The three strongest objections are "stablecoins plus smart-account limits," "networks already have agentic tokens," and "irreversibility is a feature." Sourced answers exist for all three. The honest concession is that crypto delegations keep their consent record and enforce limits at the rail, which Readback on PayPal does not (yet).

### Cited Findings
- **Limits ≠ intent.** GenLayer's founder frames the open problem as "what happens when an agent stays within its spending limits but still does the wrong thing" (Sep 25, 2026) — [MetaMask](https://metamask.io/news/genlayer-internet-court-ai-agent-jury). A payment "can satisfy every one of those limits and still violate the user's actual, plain-language mandate" (search summary of the same article).
- **No reversal on x402 or stablecoins:**
  - x402 settles with no mechanism for reversals or chargebacks — [CBA Agentic Symposium white paper, Jan 2026](https://consumerbankers.com/wp-content/uploads/2026/01/CBA-Agentic-Symposium-White-Paper-2026-01v2.pdf); [eco.com (secondary)](https://eco.com/support/en/articles/14839404-stablecoin-payments-for-ai-agents)
  - x402 has no refund mechanism, and refunds to ephemeral agent wallets may be unrecoverable — [Stablecoin Insider (secondary)](https://stablecoininsider.org/refunds-when-an-agent-initiated-the-payment/)
  - GenLayer revocation "does not reverse a payment that has already settled" — [MetaMask](https://metamask.io/news/genlayer-internet-court-ai-agent-jury)
- **Network tokens:**
  - Stripe says agentic network tokens let issuers make informed authorization decisions and "manage disputes and fraud," but SPT carries no intent record — [Stripe docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent)
  - TAP defines no intent record or dispute use — [Visa GitHub](https://github.com/visa/trusted-agent-protocol)
  - VI defines no dispute procedure — [Shane Deconinck](https://shanedeconinck.be/posts/mastercard-verifiable-intent-agents-can-prove-what-you-approved/)
  - Agent liability is still unsettled — [Worldpay](https://www.worldpay.com/en/insights/articles/agentic-commerce-liability-is-still-being-written)
- **Scoped tokens and merchant exposure:** SPT protects credentials but does little for merchants on intent disputes — [Fintech Wrap Up](https://www.fintechwrapup.com/p/deep-dive-the-hidden-liability-of)
- **PayPal itself is courting crypto rails:** PayPal and Google reps said at Consensus Miami (May 10, 2026) that agentic commerce will run on crypto rails — [CoinDesk](https://www.coindesk.com/business/2026/05/10/agentic-commerce-will-run-on-crypto-rails-paypal-and-google-reps-tell-consensus-miami)

**Draft one-sentence answers**
1. *"Why not stablecoins plus smart-account spend limits?"* Limits stop out-of-bounds payments, but even crypto's own dispute layer admits the hard case is the agent that stays within its limits and still buys the wrong thing ([MetaMask/GenLayer, Sep 2026](https://metamask.io/news/genlayer-internet-court-ai-agent-jury)); Readback records what Maya actually delegated and decides that case on a rail that can still refund her.
2. *"Networks already solve this with agentic tokens."* Agentic tokens and TAP prove which agent presented a credential, and VI records intent but "does not define dispute procedures" ([write-up of VI v0.1](https://shanedeconinck.be/posts/mastercard-verifiable-intent-agents-can-prove-what-you-approved/); [Visa TAP](https://github.com/visa/trusted-agent-protocol)); Readback is the adjudication step those leave to "later," running today on PayPal-wallet disputes, which are PayPal's own process.
3. *"Irreversibility is a feature: no chargebacks, no fraud."* Finality protects whoever got paid, including a merchant that charged without any agent request, which is exactly Readback's buyer-favor verdict, and x402 has no refund path ([CBA, Jan 2026](https://consumerbankers.com/wp-content/uploads/2026/01/CBA-Agentic-Symposium-White-Paper-2026-01v2.pdf)).
4. *"Stripe SPTs already scope agent payments."* An SPT records a seller, a cap, and an expiry, with no user instruction and no agent key ([Stripe docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent)), so it can't tell an in-terms agent purchase from a merchant charging on its own.
5. *"PayPal is going to crypto anyway."* Then PYUSD purchases will need the same mandate-and-verdict layer, because on-chain limits don't adjudicate. Readback's checks are rail-agnostic TypeScript over signed mandates. (This is an inference, not a sourced claim.)

### Inferences

**Where Readback is weaker. Say these outright, not in a footnote:**
1. **Durability.** PayPal deletes the consent record on the claim that needs it (PROPOSAL headline); on-chain delegations and user-held SD-JWTs don't disappear.
2. **Enforcement point.** VI and ERC-7715 enforce constraints at the network or contract. Readback enforces cap, item, and dates at the agent runtime and the merchant gate, and PayPal enforces only one-per-period (invoice uniqueness) and no charges after cancellation.
3. **Who signs consent.** VI's L2 is user-signed. Readback's open mandate is authenticated only by PayPal's approval page, which doesn't display the stored terms (T21).
4. **Key custody.** Coinbase signs in an enclave behind a policy engine. Readback's runtime holds the key in env.
5. **Scope.** Readback covers one merchant per agreement; VI and AP2 support cross-merchant constraints.

**The counter-pitch these support:** Readback is the only design found that combines all three of the following, today, on a mainstream consumer wallet rail:
- an agent-key-bound mandate;
- per-purchase signatures;
- a deterministic verdict that can favor the buyer against the merchant running it.

Its weaknesses are exactly what the one-field `agent_terms` proposal closes. Crypto precedent (grants persist; revocation is an event) strengthens that proposal.

### Gaps
- No source quantifies dispute or fraud rates for stablecoin agent payments versus card or PayPal agent payments.
- No source was found where PayPal comments on mandates for PYUSD or agentic stablecoin purchases specifically.
