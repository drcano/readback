# Agent payment protocols (crypto/stablecoin and card networks): how user authorization is represented, proved, and verified

Research date: Oct 26–27, 2026. "Fetched" means the page was read directly this session. "Secondary" means the claim came only from blogs, aggregators, or search summaries and was not checked against a primary source. Claims marked "repo source" are already cited in `docs/WHY-PAYPAL.md` and were not re-fetched this session.

## Coinbase x402 (HTTP 402 payments)

### Takeaway
In x402, the user's authorization is a one-time, on-chain-settleable token transfer signature: EIP-3009 `transferWithAuthorization` or a Permit2 `permitWitnessTransferFrom`. The payer's wallet signs it per request, and a facilitator verifies and settles it. The spec and repo have no intent, mandate, standing-delegation, refund, or dispute concept. Governance moved to the x402 Foundation under the Linux Foundation on Apr 2, 2026. Headline transaction counts are large, but estimates of real commerce volume are small and contested.

### Cited Findings
**Flow (fetched, x402 repo README, now under the x402 Foundation org):**
- The server answers `402 Payment Required` with a base64 `PaymentRequired` object in a `PAYMENT-REQUIRED` header. The client picks one `PaymentRequirements`, builds a `PaymentPayload`, and resends the request with it in a `PAYMENT-SIGNATURE` header. The server verifies locally or POSTs to a facilitator's `/verify`, then settles itself or via the facilitator's `/settle`. It returns `200` with a `PAYMENT-RESPONSE` header carrying the base64 Settlement Response. The README does not mention an `X-PAYMENT` header. — [x402 GitHub repo](https://github.com/coinbase/x402) (fetched Oct 2026; README says "We've moved the x402 repo under the x402 Foundation repo")
- Schemes: `exact` (fixed amount), `upto` (the payer authorizes a per-request maximum and the seller settles actual usage up to the cap), and `batch-settlement` (EVM; escrow plus off-chain vouchers redeemed in batches). Every (scheme, network) pair must be explicitly supported. — [x402 GitHub repo](https://github.com/coinbase/x402)
- The facilitator verifies payloads for a scheme and network, submits them on-chain, and returns verification and settlement responses. — [x402 GitHub repo](https://github.com/coinbase/x402)
- The README contains no intent, mandate, identity, or receipt concept (the nearest thing is the `PAYMENT-RESPONSE` settlement header), and no refund or dispute mechanism. — [x402 GitHub repo](https://github.com/coinbase/x402)

**How the payer's authorization is signed (fetched, `exact` EVM scheme spec):**
- **EIP-3009:** the payer signs `transferWithAuthorization` over `from`, `to`, `value`, `validAfter`, `validBefore`, and `nonce`. The EIP-712 domain uses `extra.name` and `extra.version`. The facilitator checks that the signature recovers to `from`, the balance, the amount and validity window against the requirements, and the token and network, then simulates the transfer. — [x402 scheme_exact_evm.md](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md)
- **Permit2:** the payer signs `permitWitnessTransferFrom` with `spender` = the `x402ExactPermit2Proxy`, and a `witness` of `to` and `validAfter`. "This Proxy enforces that funds are only sent to the `witness.to` address." — [same](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md)
- "In all cases, the Facilitator cannot modify the amount or destination." Both methods are listed as "One-time use", with a nonce and a validity window. — [same](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md)

**Governance:**
- Apr 2, 2026: the Linux Foundation announced the x402 Foundation at MCP Dev Summit NA. x402 was "initially developed by Coinbase, Cloudflare, and Stripe." Initial supporters listed: Adyen, AWS, American Express, Ampersend.ai, Base, Circle, Cloudflare, Coinbase, Fiserv, Google, KakaoPay, Mastercard, Merit Systems, Microsoft, Polygon Labs, PPRO, Shopify, Sierra, Solana Foundation, Stripe, thirdweb, and Visa. **PayPal is not listed.** — [Linux Foundation press release](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol) (fetched)
- Coinbase's docs say 40 organizations joined at launch. Premier members: AWS, American Express, Cloudflare, Coinbase, Google, Mastercard, Shopify, Solana Foundation, Stripe, and Visa. The docs also say the contribution was completed Apr 2, 2026. — [Coinbase CDP docs, x402 Foundation](https://docs.cdp.coinbase.com/x402/support/x402-foundation) (search summary)
- Date conflict: one secondary source says an "x402 Foundation" was established in September 2025 (with Cloudflare, Google, and Visa). The Apr 2, 2026 Linux Foundation launch is the formal governance transfer. — search summary of [Coinbase docs](https://docs.cdp.coinbase.com/x402/support/x402-foundation) and aggregators; not resolved
- Spec version v2 was released Dec 11, 2025, and a Batch Settlement extension was added May 11, 2026. — [presenc.ai tracker](https://presenc.ai/research/x402-protocol-adoption-tracker-2026) (secondary)

**Adoption numbers (dated, conflicting; not reconcilable):**
- Solana is "driving nearly 65% of x402 transaction volume this year" (Solana Foundation quote, Apr 2, 2026). — [Linux Foundation press release](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol)
- Cloudflare was serving about 1 billion HTTP 402 responses per day at launch (Apr 2026). — search summary of the [LF press release](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol) (not in the fetched extract; treat as secondary)
- Coinbase-reported, by Apr 2026: about 165M cumulative transactions, about $50M volume, and 69,000 active agents. — [presenc.ai](https://presenc.ai/research/x402-protocol-adoption-tracker-2026) (secondary)
- "More than 230 million transactions in just over a year" (Coinbase, via secondary). — search summary citing [coinsdo](https://www.coinsdo.com/en/blog/x402-ap2-agent-payment-protocols-explained) (secondary)
- The x402.org dashboard showed about 75M trailing-30-day transactions and about $24M volume in mid-July 2026. — [presenc.ai](https://presenc.ai/research/x402-protocol-adoption-tracker-2026) (secondary)
- Chainalysis: more than 100M cumulative x402 transactions on Base through Q1 2026, with much of the late-2025 surge being meme-coin activity. — [presenc.ai](https://presenc.ai/research/x402-protocol-adoption-tracker-2026) (secondary)
- Real-commerce volume was about $28K/day (CoinDesk, March 2026), and Artemis classifies roughly half of activity as artificial or gamified. — [presenc.ai](https://presenc.ai/research/x402-protocol-adoption-tracker-2026), [agentbets](https://agentbets.ai/guides/agentic-payments-protocols/) (secondary)
- Another secondary source claims more than $600M volume and about 500K active AI wallets. — [eco.com](https://eco.com/support/en/articles/14730447-paypal-agentic-commerce-explained) (secondary; conflicts with the above)

### Inferences
- x402's authorization record is the signed transfer itself. Once settled, it is on a public chain and cannot be deleted by any central party. But it proves only "this wallet paid X to Y", not what a human instructed. In `upto`, the signed cap is a per-request ceiling, not a standing mandate.
- Because there's no refund or dispute concept, x402 has nothing like a "my agent bought that" dispute. Settlement is final, and recourse is off-protocol.
- Whoever holds the wallet key is the authorizer. If the agent holds the key, x402 cannot tell a user-sanctioned payment from an agent acting outside its instructions.

### Gaps
- No primary x402.org dashboard figure was fetched; all usage numbers above are secondary.
- The Solana (SVM) signing scheme was not fetched.
- Whether any x402 extension adds identity or intent (e.g., "sign-in-with-x" or receipts) was not checked.

## Google AP2 (Agent Payments Protocol)

### Takeaway
The current spec on GitHub is **v0.2**. It defines **two** mandate types, **Checkout Mandate and Payment Mandate**, each open (constraints) or closed (final values), secured as SD-JWTs. In autonomous (human-not-present) mode, the open mandate must carry the agent's public key as `cnf`, and the agent signs the closed mandates. Google contributed AP2 to the FIDO Alliance on Apr 28, 2026, alongside Mastercard's Verifiable Intent. The crypto rail is a separate A2A x402 extension (v0.1), whose relationship to AP2 mandates isn't specified.

### Cited Findings
**Spec (fetched, v0.2):**
- Title: "Agentic Payment Protocol (v0.2)." "AP2 defines two Mandate types: Checkout Mandate and Payment Mandate." The fetched spec doesn't use Intent/Cart terminology. — [AP2 specification.md](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- "AP2 specifies the use of `SD-JWT`s for securing the Payment and Checkout Mandates." Schemas are identified by a `vct` claim with a version suffix (e.g., `mandate.payment.1`). — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- Autonomous open mandates "MUST include the agent's public key as a `cnf` claim." The Shopping Agent signs the closed mandates with that key. The agent may not present a new open mandate until it receives a rejection receipt for the previous one. — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- The Payment Mandate binds to the checkout by a hash of the Checkout JWT. The merchant signs the Checkout JWT, which must use a non-deterministic signature scheme such as ECDSA, not Ed25519. — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- Human-present mode: the user approves the closed checkout and payment on a **Trusted Surface**, which must be non-agentic. — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- Verifiers:
  - The merchant verifies the Checkout Mandate, the checkout hash, and open-mandate constraints.
  - The Credential Provider and Network verify the Payment Mandate and its constraints. The Credential Provider verifies before issuing a payment credential.
  - The Merchant Payment Processor checks that the credential is scoped to the checkout.
  - Validation must run in deterministic code.
  - Signed Payment Receipts go to the Shopping Agent, Credential Provider, and possibly the Network.
  — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- Disputes: mandates plus receipts give a "non-repudiable picture of the transaction." Verifiers must recompute hashes and re-verify both mandates. **Retention and retrieval are out of scope.** The spec names which roles may supply evidence: the Shopping Agent and Merchant for checkout records; the Shopping Agent, Credential Provider, Network, and Merchant Payment Processor for payment records. It suggests the Payment Mandate `transaction_id` as a future lookup key. — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- The spec says it is designed to be compatible with the Universal Commerce Protocol (UCP). It does not mention x402, stablecoins, or FIDO. — [same](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)

**FIDO Alliance (fetched):**
- Apr 28, 2026: Google contributed AP2, and Mastercard contributed Verifiable Intent (co-developed with Google; "works with AP2"). Two working groups:
  - **Agentic Authentication TWG:** chairs CVS Health, Google, and OpenAI; vice-chairs Amazon, Google, and Okta.
  - **Payments TWG:** chairs Mastercard and Visa. It will build on the AP2 and Verifiable Intent contributions.
  - No deliverable dates. The announcement does not address disputes. PayPal (Rakan Khalid) is among the quoted supporters.
  — [FIDO Alliance announcement](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/)

**Partners (dated claims, not a contradiction):**
- 60+ partners at the September 2025 launch, including PayPal, Mastercard, and American Express. — [nohacks.co](https://nohacks.co/blog/agent-payments-protocol-60-organizations) (secondary)
- "More than 120 partners, including PayPal" (Richard Widmann, Google Cloud, Consensus Miami). — [CoinDesk, May 10, 2026](https://www.coindesk.com/business/2026/05/10/agentic-commerce-will-run-on-crypto-rails-paypal-and-google-reps-tell-consensus-miami) (fetched)
- PayPal's developer blog (Sep 16, 2025) listed extending Seller Protection with AP2 mandates and signatures as dispute evidence as an opportunity. — [PayPal Developer blog](https://developer.paypal.com/community/blog/PayPal-Agent-Payments-Protocol/) (repo source P5, not re-fetched)

**Crypto extension (A2A x402):**
- The `google-agentic-commerce/a2a-x402` repo holds `spec/v0.1`. Flow: the merchant agent sends `payment-required`, the client agent signs and returns `payment-submitted`, and the merchant verifies, settles on-chain, and returns `payment-completed`. The README does not say whether an AP2 Payment Mandate is carried, and mentions neither EIP-3009 nor specific stablecoins. — [a2a-x402 repo](https://github.com/google-agentic-commerce/a2a-x402) (fetched; no dates shown)
- Secondary: built with Coinbase, the Ethereum Foundation, and MetaMask. It carries payments in A2A task metadata rather than HTTP 402. An October 2026 guide says Google's x402 samples are demos and "the AP2-native x402 extension is still pending." — [coinsdo](https://www.coinsdo.com/en/blog/x402-ap2-agent-payment-protocols-explained), [stablecoininsider](https://stablecoininsider.org/how-to-set-up-ap2-x402-stablecoin-payments/) (secondary)
- Google Cloud's Widmann: agents "cannot get a bank account," crypto is "a fantastic machine readable interface for payments," Google extended Cloud KMS to crypto custody, and an agent should hold only one of two or three key shards so it "cannot simply unilaterally move funds." — [CoinDesk, May 10, 2026](https://www.coindesk.com/business/2026/05/10/agentic-commerce-will-run-on-crypto-rails-paypal-and-google-reps-tell-consensus-miami)

### Inferences
- The task's "Intent/Cart/Payment mandates" naming matches earlier AP2 material (v0.1). v0.2 as fetched uses Checkout/Payment, open/closed. The v0.1 details were not re-verified this session.
- AP2 makes mandates user- or agent-signed objects that any party holding a copy can verify. But it delegates who keeps them, and for how long, to implementers. In practice the record lives with whichever roles (agent platform, merchant, credential provider, network) retained it, so it is only as durable as those parties' retention.
- AP2's stablecoin story is a parallel A2A extension, not a mandate-bound rail. Nothing fetched shows an x402 payment carrying or referencing an AP2 Payment Mandate.

### Gaps
- Exact v0.2 release date (secondary sources say Apr 28, 2026, the same day as the FIDO donation; not confirmed on GitHub).
- Whether any production AP2 deployment (credential provider or network verifying SD-JWT mandates) is live: none found.
- Status of verifiable-credential mandate issuance (who issues user keys, wallet support): not found beyond the spec.

## Stripe: Agentic Commerce Protocol, Shared Payment Tokens, MPP, Tempo, Bridge

### Takeaway
Stripe's agent authorization primitive is the **Shared Payment Token (SPT)**, a PSP-issued token scoped to one merchant and a capped amount with an expiry. ACP's delegated-payment spec models it as an `allowance` with `reason: one_time`. As of Sessions 2026 (Apr 29, 2026), Stripe also ships the **Machine Payments Protocol (MPP)**, co-authored with Tempo, which carries stablecoins and SPT-based fiat. The authorization record lives with Stripe/the PSP, and chargebacks "remain with the merchant and their PSP."

### Cited Findings
**ACP delegated payment spec (fetched):**
- The `allowance` object has `reason` (only `one_time` listed), `max_amount`, `currency`, `checkout_session_id`, `merchant_id`, and `expires_at` (RFC 3339). The PSP or vault "returns a payment token scoped to the delegated payment" (`vt_` prefix). — [OpenAI Commerce: Delegated payment spec](https://developers.openai.com/commerce/specs/payment)
- Requests carry a `Signature` header (Base64 signature of the body), `Timestamp`, `Idempotency-Key`, and `Request-Id`. The algorithm and key management are not specified. — [same](https://developers.openai.com/commerce/specs/payment)
- "Settlement, refunds, chargebacks, and compliance remain with the merchant and their PSP"; OpenAI is not the merchant of record. Only `card` is listed. Stripe's SPT is the first compatible implementation, with "more PSPs coming soon." — [same](https://developers.openai.com/commerce/specs/payment)
- Secondary: the latest stable ACP spec is dated 2026-04-17, Apache-2.0. — [eco.com ACP explainer](https://eco.com/support/en/articles/14845478-acp-agentic-commerce-protocol-explained) (secondary)
- Secondary, unverified against OpenAI: OpenAI retired or deprioritized in-chat Instant Checkout in March 2026, moving purchases to merchant sites. — [paz.ai](https://www.paz.ai/agentic-commerce), [clinkbill](https://clinkbill.com/blog/what-is-agentic-commerce-protocol) (secondary)

**Sessions 2026 (Apr 29, 2026; fetched):**
- Shipped:
  - **MPP**, co-authored by Stripe and Tempo: accept agent payments in stablecoins or in fiat (cards, Klarna, Affirm) via SPTs through the Payment Intents API.
  - **Agentic Commerce Suite** (catalog upload, agent access management).
  - **Link agent wallet**, with "spending approvals" and "full purchase visibility."
  - Stablecoin acceptance in 32 more markets.
  - **Bridge** support for Tempo, Plasma, Celo, and Sui.
  - **Smart Disputes**, which recommends extra evidence from an evidence library.
- Preview: agent guardrails (agent identities, scope rules, approval flows), Issuing single-use virtual cards for agents, and Radar bot-abuse prevention to distinguish legitimate agents.
- Roadmap: auto-resolving disputes (Q4 private preview); Privy human review (Q1 GA) and preconfigured spending policy sets (Q4 private preview).
- The recap names neither ACP nor x402.
— [Stripe, "Everything we announced at Sessions 2026"](https://stripe.com/blog/everything-we-announced-at-sessions-2026)
- Secondary: Tempo (Stripe/Paradigm payments L1) went live on mainnet Mar 18, 2026, and is permissioned with a roadmap to permissionless validation. Stripe has an x402 preview settling USDC on Base, Solana, or Tempo. — [everstake](https://everstake.com/resources/blog/what-is-tempo-stripe-and-paradigms-stablecoin-payments-blockchain-explained), [tomcn.uk](https://tomcn.uk/news/2026-04-01-stripe-tempo-ai-agent-payment-rails), [eco.com](https://eco.com/support/en/articles/14839406-stripe-link-agents-and-x402-explained) (secondary; the x402 preview is not in Stripe's own recap)
- Stripe is a co-developer of x402 and a premier member of the x402 Foundation. — [LF press release](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol)

### Inferences
- An SPT is a bearer-style scoped credential, not a user-signed statement of intent. The "authorization" is Stripe's (or the PSP's) record of the scope it minted, so it is held centrally and is subject to that provider's retention.
- ACP's allowance is single-use (`one_time`), so it has no recurring or standing-mandate model comparable to AP2's open mandates.

### Gaps
- MPP's wire format and whether it carries any user-signed mandate: not fetched.
- Whether Stripe dispute evidence for agent payments includes SPT scope data: not found.

## Visa Intelligent Commerce / Trusted Agent Protocol; Mastercard Agent Pay / Verifiable Intent

### Takeaway
**Visa TAP** authenticates the *agent* (RFC 9421 HTTP message signatures checked against a key registry), not the user's instruction. Visa's public material fetched this session doesn't describe how user intent is captured or bound. **Mastercard Verifiable Intent** is the most complete user-intent record among the networks. It is a three-layer SD-JWT chain:
- L1: an issuer credential binding the user's device key;
- L2: a user-signed mandate binding the agent key via `cnf`;
- L3: agent-signed final values.

It is still a Draft v0.1 that places dispute resolution explicitly out of scope, and its Agent Pay integration was announced as "coming months."

### Cited Findings
**Visa:**
- TAP is "a verifiable, cryptographic standard" so merchants can tell approved agents from bots. It is based on RFC 9421: the merchant rebuilds the signature base string and verifies against the agent's public key. The page says the protocol also covers consumer-recognition and payment signatures, but gives no detail. — [Visa Developer: TAP specifications overview](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications) (fetched)
- The reference repo says signatures carry a timestamp, a session identifier, a key ID, and an algorithm ID. They are bound to the merchant domain and the operation (browse or pay) and valid for a single use. An Agent Registry acts as the public-key registry. Consumer identifiers (Payment Account Reference, optional loyalty number, email, phone) are shared with consent. — [visa/trusted-agent-protocol](https://github.com/visa/trusted-agent-protocol) (fetched)
- Secondary: TAP launched October 2025 with about 12 partners (Adyen, Shopify, Stripe, etc.) and uses Ed25519. — [ATXP comparison](https://atxp.ai/blog/mastercard-agent-pay-stripe-acp-visa-x402-comparison-2026/), [stellagent](https://stellagent.ai/insights/visa-tap-trusted-agent-protocol) (secondary; algorithm not confirmed in fetched pages)
- June 10, 2026 (Visa Payments Forum):
  - Agent Score; an Agentic Directory of Visa-verified agents and merchants; a Large Transaction Model; and a "strategic collaboration" with OpenAI.
  - Richer token data plus a new "token assurance signal."
  - Stablecoin settlement at about a $7B annualized run rate (March 2026), with more than 160 stablecoin-linked card programs.
  - The release does not describe intent capture, TAP, x402/MPP, or disputes, and does not state GA for most items.
  — [Visa press release](https://usa.visa.com/about-visa/newsroom/press-releases.releaseid.22491.html) (fetched)
- Secondary: Visa's agentic payments report lists TAP, x402, MPP, ACP, and UCP as supported protocols. Visa's stablecoin settlement is issuer/acquirer settlement, separate from agent credentials. — [nevermined](https://nevermined.ai/blog/visa-intelligent-commerce-review), [Visa report PDF](https://www.visa.com/vcom-assets/content/dam/visa/reimagine-visa/thought-leadership/documents/agentic-payments-report.pdf) (summary only; PDF not fetched)
- Secondary: Ant International, Visa, and Mastercard agreed on a shared Know-Your-Agent framework, so an agent verified by one need not be re-verified by another. TAP and VI remain separate. — [Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/ant-international-visa-mastercard-agree-113452904.html) (secondary, date not captured)

**Mastercard:**
- Verifiable Intent was announced Mar 5, 2026, co-developed with Google, as an open standard for a tamper-resistant record of what a user authorized. The Agent Pay integration was expected "in the coming months." — [Mastercard story](https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html) (repo source N4; this session's fetch returned HTTP 403)
- Reference spec repo (fetched): "Maintained by Mastercard; open to multi-stakeholder contribution." Status "Draft (v0.1)", Apache-2.0, docs at verifiableintent.dev. The layers:
  - **L1** is an SD-JWT from the credential provider to the user, with identity, `pan_last_four`, and scheme. Its `cnf.jwk` is the user device key. Lifetime about 1 year.
  - **L2** is a KB-SD-JWT signed by the user device key. In Immediate mode it holds final checkout and payment values (about 15 minutes). In Autonomous mode it holds checkout and payment constraints, each with `cnf.jwk` set to the agent key (24 hours to 30 days).
  - **L3** (autonomous only) is agent-signed. L3a goes to the network (final payment, `transaction_id`, instrument) and L3b to the merchant (`checkout_jwt`, `checkout_hash`). L3a's `transaction_id` must equal L3b's `checkout_hash`. Lifetime about 5 minutes.
  - Binding uses RFC 7800 `cnf`. Each role sees only the claims it needs (selective disclosure).
  — [agent-intent/verifiable-intent](https://github.com/agent-intent/verifiable-intent)
- The same repo: "Dispute resolution is explicitly out of scope," yet the chain provides "cryptographic evidence" that agent actions stayed within delegated scope. It calls network dispute liability ambiguous today. Credential storage is not stated. — [same](https://github.com/agent-intent/verifiable-intent)
- Secondary: Agent Pay wraps Agentic Tokens and VI. Formal pilots began February 2026. Mastercard says US issuers and all European issuers are enabled, though disclosed transactions are controlled pilots. A September 2026 Alchemy collaboration covers provisioning tokenized credentials and "communicating Verifiable Intent." — [stellagent](https://stellagent.ai/insights/mastercard-agent-pay-agentic-tokens), [fintechspecs](https://fintechspecs.com/blog/mastercard-alchemy-agentcard-agent-pay-verifiable-intent/) (secondary)
- Mastercard and Visa chair FIDO's Payments TWG, which builds on AP2 and VI. — [FIDO Alliance, Apr 28, 2026](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/)

### Inferences
- VI and AP2 v0.2 converge on the same shape: a user-signed open mandate binding an agent key via `cnf`, then agent-signed closed mandates for merchant and network. This is the shape Readback implements with PayPal's approval page standing in for the user signature.
- VI's L1 is issued by a credential provider (Mastercard per secondary sources). The root of trust is therefore central, but the L2/L3 objects are portable signed artifacts. Who retains them is unspecified.
- TAP answers "is this a trusted agent?" rather than "what did the user authorize?". On the Visa side, intent binding appears to sit in token controls set at enrollment, which are network-held.

### Gaps
- Visa's mechanism for capturing user instructions (e.g., passkey-authenticated "payment instructions") was not confirmed in any fetched Visa page.
- The full TAP spec (tags, algorithms, payment container) was not fetched.
- Whether VI is live in Agent Pay production as of Oct 2026: no primary confirmation found.

## PayPal: PYUSD, agentic commerce services, toolkit, and protocol support

### Takeaway
PayPal's agent offering is fiat-first:
- **Agent Ready** (accept payments via AI assistants);
- **Store Sync** (catalog to agents);
- **ACP adoption** for ChatGPT (Oct 28, 2025);
- AP2 partnership and FIDO participation;
- an Agent Toolkit and MCP.

No primary source this session shows PayPal supporting x402, or a PYUSD rail specifically for agents. PayPal is not an x402 Foundation member. PYUSD for agents exists only as executive positioning (CoinDesk, May 2026). PayPal's public docs don't describe how buyer authorization or disputes work for agent transactions.

### Cited Findings
- **Agentic Commerce Services docs (last updated Oct 14, 2026):**
  - **Agent Ready:** accept payments through AI assistants with minimal changes. It supports "supervised and automatic shopping."
  - **Store Sync:** makes products discoverable and pushes orders into existing order management. Partners: Wix, Commerce (BigCommerce and Feedonomics), and Shopware.
  - Onboarding is via a request form.
  - The page doesn't mention ACP, UCP, AP2, MCP, buyer authorization method, dispute protection, PYUSD, stablecoins, x402, or crypto.
  — [PayPal Docs: Agentic commerce services](https://developer.paypal.com/docsai/growth/agentic-commerce/overview) (fetched)
- Oct 28, 2025: PayPal and OpenAI announced that PayPal would adopt ACP and power Instant Checkout in ChatGPT. — [PayPal/OpenAI release PDF](https://s205.q4cdn.com/875401827/files/doc_news/OpenAI-and-PayPal-Team-Up-to-Power-Instant-Checkout-and-Agentic-Commerce-in-ChatGPT-2025.pdf) (search result; not fetched). Agentic commerce services launched the same day. — [PR Newswire](https://www.prnewswire.com/news-releases/paypal-launches-agentic-commerce-services-to-power-ai-driven-shopping-302596548.html) (search result)
- Jan 21, 2026, PayPal newsroom:
  - Names ACP, UCP, AP2, A2A, and MCP. Says PayPal works "closely with both OpenAI and Google" and claims a "protocol-agnostic design."
  - Store Sync distributes catalogs to ChatGPT, Microsoft Copilot, and Perplexity.
  - Lists "returns, disputes" as functions protocols should support, without describing PayPal's agent dispute policy.
  - No mention of x402.
  — [PayPal Newsroom](https://newsroom.paypal-corp.com/2026-01-22-Making-Sense-of-the-AI-Shopping-Protocol-Moment) (fetched)
- May 2026: PayPal SVP/GM of crypto May Zabaneh called PYUSD "a very natural programmable layer for payments," citing AI-native experiences. A PayPal survey found 95% of merchants see AI agent traffic but only 20% have machine-readable catalogs. She said liability for bad agent purchases is something the industry must still work through. No PYUSD agent figures and no x402 plans. — [CoinDesk, May 10, 2026](https://www.coindesk.com/business/2026/05/10/agentic-commerce-will-run-on-crypto-rails-paypal-and-google-reps-tell-consensus-miami) (fetched)
- PayPal is not in the x402 Foundation's initial supporter list (Apr 2, 2026). — [LF press release](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol)
- PayPal (Rakan Khalid) is a quoted supporter of FIDO's agent standards work (Apr 28, 2026). — [FIDO Alliance](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/)
- Secondary:
  - PYUSD runs on Ethereum, Solana, Stellar, Tron, and Arbitrum, plus PYUSD0 via LayerZero. — [eco.com](https://eco.com/support/en/articles/14730447-paypal-agentic-commerce-explained)
  - PYUSDx, for app-specific PYUSD-backed stablecoins, launched February 2026. — [BlockEden](https://blockeden.xyz/blog/2026/04/11/paypal-openai-agent-checkout-protocol-pyusd-agentic-commerce/)
  - PYUSD is one of several ERC-20s usable with x402, but x402 settles mainly in USDC. — [agentbets](https://agentbets.ai/guides/agentic-payments-protocols/)
  - Third-party guides say Agent Ready runs via Braintree, with ACP for ChatGPT and UCP for Google AI Mode/Gemini. — [stellagent](https://stellagent.ai/insights/paypal-agentic-commerce-agent-ready)
- PayPal's 10-Q (Q2 2026) says PYUSD is designed to comply with the US framework, with international rules uncertain. — [PayPal 10-Q](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000082/pypl-20260630.htm) (search summary; not fetched)
- Repo sources, not re-fetched:
  - Agent Ready says Seller and Purchase Protection, fraud tools, chargeback coverage, and identity services extend to agentic transactions. — [PayPal AI Agent Ready](https://www.paypal.ai/us/agent-ready) (P6)
  - "How PayPal's Seller Protection is evolving for the agentic commerce era," Apr 30, 2026. — [PayPal BRC](https://www.paypal.com/us/brc/article/seller-protection-agentic-commerce) (S1)
  - WebMCP agent-ready merchants, Sep 16, 2026. — [PayPal Dev blog](https://developer.paypal.com/community/blog/WebMCP_PayPal_Agent_Ready) (P8)
  - "One connection. 2,000 tools," Oct 8, 2026. — [PayPal Dev blog](https://developer.paypal.com/community/blog/One_connection_2000_tools) (P9)
  - Agent Toolkit v1.11.0, Sep 1, 2026; its dispute tools are list/get/accept. — [paypal/agent-toolkit](https://github.com/paypal/agent-toolkit) (A4)

### Inferences
- In every PayPal agent path found, the shopper's authorization is a PayPal-held record (wallet approval, vault token, billing agreement). There's no user- or agent-signed mandate object in PayPal's published products. PayPal's own Sep 2025 AP2 blog names mandates as dispute evidence only as a future opportunity (repo source P5).
- PYUSD gives PayPal an on-chain rail, but nothing found ties PYUSD payments to a mandate, an x402 flow, or PayPal's dispute processes. On-chain PYUSD transfers would inherit x402's finality, not PayPal Purchase Protection, unless PayPal says otherwise (no source found).

### Gaps
- No PayPal primary source on x402 support, PYUSD agent payments, or a PayPal facilitator. Treat these as absent, not as confirmed "no."
- PayPal Agent Ready's actual buyer-authorization mechanism and agent-dispute terms are not in public docs fetched.
- Whether PayPal's ACP/Instant Checkout integration survived OpenAI's reported March 2026 checkout pullback is unconfirmed.

## Where each protocol's authorization record lives, and whether it serves as dispute evidence

### Takeaway
Only x402 puts the authorization on a chain that no central party can delete, and that authorization is just a per-payment transfer signature with no statement of intent and no dispute path. AP2 and Verifiable Intent define portable, signed intent records (user-signed open mandates binding an agent key, then agent-signed closed mandates). Both leave retention and dispute resolution out of scope. Stripe/ACP, Visa, and PayPal keep the authorization as a centrally held token or account record, and none publishes how it feeds disputes.

### Cited Findings
| Protocol | Authorization artifact | Who signs | Who holds the record | Dispute evidence | Status (Oct 2026) |
|---|---|---|---|---|---|
| x402 | EIP-3009 / Permit2 signed transfer, one-time, with nonce and validity window — [scheme spec](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md) | Payer wallet key | Public chain after settlement (not deletable) | None in spec or README; no refund or dispute concept — [repo](https://github.com/coinbase/x402) | Shipped; v2; Linux Foundation governance since Apr 2, 2026 — [LF](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol) |
| AP2 v0.2 | Checkout and Payment Mandates as SD-JWT, open or closed; `cnf` = agent key in autonomous mode — [spec](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md) | User on a Trusted Surface (open mandates, human-present); agent (closed mandates, autonomous); merchant (Checkout JWT) | Unspecified; "retention and retrieval out of scope" — [spec](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md) | "Non-repudiable picture"; spec names which roles may furnish evidence — [spec](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md) | Spec; contributed to FIDO Apr 28, 2026 — [FIDO](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/) |
| A2A x402 | Signed on-chain payment in A2A messages — [repo](https://github.com/google-agentic-commerce/a2a-x402) | Client agent wallet | Chain | Not specified | v0.1 spec |
| Mastercard Verifiable Intent | L1 issuer SD-JWT, L2 user KB-SD-JWT (agent `cnf`), L3 agent-signed — [repo](https://github.com/agent-intent/verifiable-intent) | Credential provider, user device key, agent key | "Not stated" | "Dispute resolution is explicitly out of scope"; the chain is called "cryptographic evidence" — [repo](https://github.com/agent-intent/verifiable-intent) | Draft v0.1; Agent Pay integration announced, not confirmed live |
| Visa TAP / Intelligent Commerce | RFC 9421 agent request signature; token controls — [Visa Dev](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications) | Agent key (registered in Visa's registry) | Visa / issuer (token); registry — [repo](https://github.com/visa/trusted-agent-protocol) | Not covered in fetched Visa pages — [Jun 10 release](https://usa.visa.com/about-visa/newsroom/press-releases.releaseid.22491.html) | TAP public since Oct 2025 (secondary); June 2026 items mostly undated for GA |
| Stripe ACP / SPT / MPP | `allowance` (`one_time`, `max_amount`, `merchant_id`, `expires_at`) → PSP-issued token — [ACP spec](https://developers.openai.com/commerce/specs/payment) | PSP mints; request body signature (algorithm unspecified) | Stripe / PSP | "Chargebacks… remain with the merchant and their PSP" — [ACP spec](https://developers.openai.com/commerce/specs/payment) | SPT and MPP shipped Apr 29, 2026 — [Stripe](https://stripe.com/blog/everything-we-announced-at-sessions-2026) |
| PayPal Agent Ready / Store Sync | Not described publicly — [PayPal Docs, Oct 14, 2026](https://developer.paypal.com/docsai/growth/agentic-commerce/overview) | PayPal account approval (inferred) | PayPal | Agent Ready claims protections extend to agent transactions — [paypal.ai](https://www.paypal.ai/us/agent-ready) (repo source) | Live via request form |

### Inferences
- Deletion risk is real for the centrally held models. For PayPal specifically, the repo's own spike found that an unauthorized claim deletes the agreement (commit `039e41e`, `docs/decisions/0001-sandbox-spike.md`). This is a local finding, not from external sources.
- No protocol surveyed ships a defined dispute process that consumes signed mandates. AP2 and VI both produce evidence-grade artifacts and explicitly stop short of dispute handling. That is the gap a "mandate as dispute evidence" product fills.
- Crypto rails (x402, A2A x402, PYUSD, Tempo) offer non-deletable settlement records but carry no user intent. Intent-bearing standards (AP2, VI) are rail-agnostic signed objects whose persistence depends on whoever stores them.

### Gaps
- No source found showing any network or PSP accepting AP2/VI mandates in a live dispute (chargeback or PayPal claim).
- Retention practices of agent platforms (OpenAI, Google) for mandate or authorization records: not found.
