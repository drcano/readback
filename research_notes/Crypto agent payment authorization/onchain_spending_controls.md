# On-chain spending controls for AI agents (smart accounts, session keys, permissions, agent wallets)

Research date: 2026-10-26/27. All URLs accessed on that date. Most vendor doc pages carry no publication date; where a page is undated, that is stated. Secondary (third-party) sources are marked **[secondary]**.

## 1. How limits are encoded and enforced on-chain (ERC-4337 / ERC-7579 accounts, session keys, spending-limit modules)

### Takeaway
Every major smart-account stack expresses an agent's authority as **one signer key + N policies** (amount per period, token, target contract/function, parameter rules, time window, usage count), enforced by a contract at execution time. The concrete encodings differ: Coinbase Spend Permissions is a fixed 9-field struct checked by one singleton contract; Safe's Allowance Module is a per-(Safe, token, delegate) counter; Biconomy/Rhinestone Smart Sessions and ZeroDev Kernel are composable ERC-7579-style policy modules.

### Cited Findings
**Coinbase Spend Permissions (Coinbase Smart Wallet / Base Account)**
- The `SpendPermission` struct has exactly nine fields: `account` (smart account), `spender` ("Entity that can spend `account`'s tokens"), `token` (ERC-7528 native-token address or ERC-20), `allowance` (uint160, "Maximum allowed value to spend within each `period`"), `period` (uint48 seconds, recurring reset), `start` (inclusive), `end` (exclusive), `salt`, `extraData` — [SpendPermissionManager.sol](https://raw.githubusercontent.com/coinbase/spend-permissions/main/src/SpendPermissionManager.sol)
- Enforcement in `_useSpendPermission`: reverts on zero value, on not-approved-or-revoked (`UnauthorizedSpendPermission`), outside `[start, end)`, or if `value + currentPeriod.spend > allowance` (`ExceededSpendPermission`); otherwise records period spend and emits `SpendPermissionUsed`. Period start is computed as `now - ((now - start) % period)`, capped at `end` — [SpendPermissionManager.sol](https://raw.githubusercontent.com/coinbase/spend-permissions/main/src/SpendPermissionManager.sol)
- The manager is installed as an **owner** of the user's Coinbase Smart Wallet (V1 modular owner system); approval is an `eth_signTypedData` signature (ERC-6492-wrapped if the account is undeployed), or `approveWithSignature`, or a direct `approve` call; spending is `SpendPermissionManager.spend(permission, recipient, amount)` — [coinbase/spend-permissions README](https://github.com/coinbase/spend-permissions)
- Singleton address `0xf85210B21cC50302F477BA56686d2019dC9b67Ad`, deployed on Base, Ethereum, Optimism, Arbitrum, Polygon, Zora, BSC, Avalanche (+ Sepolia testnets). Audits by Spearbit/Cantina: private 10/29/2024, public competition 11/2024, private 12/10/2024; a newer `SpendRouter` audited 03/18/2026 and 03/21/2026 (address "TBD" at time of reading) — [coinbase/spend-permissions README](https://github.com/coinbase/spend-permissions)
- SDK: `requestSpendPermission` builds an EIP-712 payload and asks the user to sign; required inputs are account, spender, token, chainId, per-period max — [CDP docs: requestSpendPermission](https://docs.cdp.coinbase.com/coinbase-wallet/reference/spend-permission-utilities/requestSpendPermission). Base publishes an "AI agent" cookbook built on it — [Base cookbook: spend permissions AI agent](https://docs.base.org/cookbook/spend-permissions-ai-agent)
- **Status flag (late 2026):** Base Account SDK docs have moved to CDP and been renamed "Coinbase Wallet SDK"; Base MCP renamed "Wallet MCP" — [docs.base.org notice](https://docs.base.org/identity/smart-wallet/guides/spend-permissions). The CDP guide says Spend Permissions in **Coinbase Wallet (formerly Base App) are "coming soon"** — [CDP docs: spend permissions](https://docs.cdp.coinbase.com/coinbase-wallet/improve-ux/spend-permissions). (Contract is live on mainnets; consumer-wallet support is the pending part.)

**Safe Allowance Module**
- Per (Safe, token, delegate) it stores `amount` (uint96), `spent` (uint96), `resetTimeMin` (uint16; 0 = one-time), `lastResetMin` (uint32), `nonce` (uint16, replay protection). Owners configure via Safe transactions: `addDelegate`, `setAllowance`, `resetAllowance`, `deleteAllowance`, `removeDelegate` — [safe-modules/allowances](https://github.com/safe-global/safe-modules/tree/main/modules/allowances)
- Anyone may relay `executeAllowanceTransfer` with an EIP-712 authorization **signed by the delegate** covering Safe, token, recipient (`to`), amount, payment token, payment, nonce. Recipient is not restricted by the allowance itself (any `to`). Delegates are indexed by first 6 bytes of address (collisions possible) — [safe-modules/allowances](https://github.com/safe-global/safe-modules/tree/main/modules/allowances)

**Biconomy / Rhinestone Smart Sessions (ERC-7579)**
- Action-policy fields: `contractAddress` (required), `valueLimit` (native per tx), `tokenLimits` (ERC-20 caps), `validAfter`/`validUntil`, `usageLimit`, `sudo` (unlimited; can't combine with rules), and one of `functionSelector` / `rules` / `abi`. Rules compare a calldata parameter (`offsetIndex`) against a `ref` with EQUAL/GT/LT/GTE/LTE/NEQ, optionally with cumulative `usage` limits — [Biconomy: Smart Session Policies](https://docs.biconomy.io/new/smart-sessions/policies)
- Session creation takes `sessionPublicKey` (required for K1 validator), `sessionValidatorAddress`, `sessionValidAfter/Until`, `chainIds`, `actionPoliciesInfo` — [Biconomy: Smart Session Policies](https://docs.biconomy.io/new/smart-sessions/policies); separate usage-limit policy caps number of session-key uses — [Biconomy: usage limit policy](https://docs.biconomy.io/new/smart-sessions/policies/usage-limit-policy.md)
- Fee interaction: if the session token equals the fee token the SDK merges policies, raising the effective spend limit by `maxPaymentAmount` — [Biconomy sessions SDK reference](https://docs.biconomy.io/sdk-reference/sessions)
- Rhinestone/Biconomy described as co-developers of Smart Sessions; multiple production session implementations (MetaMask, Biconomy, Rhinestone, Alchemy) with limited cross-SDK interop — **[secondary]** [Eco: What is Rhinestone](https://eco.com/support/en/articles/11803001-what-is-rhinestone-erc-7579-smart-accounts)

**ZeroDev Kernel**
- "Permission = 1 signer + N policies + 1 action". Signers: ECDSA, WebAuthn/passkeys, multisig. Policies: Sudo, Call (contract/function/param restrictions), Gas, Rate limit (UserOps per window), Timestamp, Signature (which messages may be signed). Kernel claims to be "the first smart account to support composable permissions" — [ZeroDev: Permissions intro](https://docs.zerodev.app/sdk/permissions/intro)

**ERC-7710 / MetaMask (caveat enforcers)**
- ERC-7710 (Draft, created 2024-05-20; requires EIP-1271 and ERC-7579): a delegate calls `redeemDelegations(_permissionContexts, _modes, _executionCallData)` on a Delegation Manager, which validates authority and has the delegator execute; batches must be atomic. The ERC itself does not define caveats or a revocation mechanism — [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710)
- In MetaMask's implementation, caveat enforcers are contracts that gate each redemption; "without caveat enforcers, a delegation has infinite and unbounded authority" — [MetaMask: caveat enforcers](https://docs.metamask.io/delegation-toolkit/concepts/caveat-enforcers)

### Inferences
- All on-chain approaches enforce limits at execution time in a contract the verifier can read; none depend on the agent or merchant behaving. The weakest points are policy expressiveness (Safe's allowance has no recipient restriction; Coinbase's struct has no recipient/merchant field, only `spender`) and the "sudo" escape hatch in Biconomy/ZeroDev.
- Coinbase's model (fixed allowance per period, one spender, one token, start/end) is structurally the closest analogue to a PayPal recurring-prepaid vault agreement with period cap.

### Gaps
- Rhinestone's own Smart Sessions docs (docs.rhinestone.dev/smart-sessions/overview) returned 404; Rhinestone-specific policy contract interfaces not verified.
- ZeroDev's enable/revoke mechanics (enable signature, uninstall) not documented on the page fetched.
- Safe Allowance Module events and audit status not shown on the module page.

## 2. ERC-7715 and ERC-7710: status, adoption, what a "permission" contains

### Takeaway
ERC-7715 is still **Draft** (created 2024-05-24) and its method has been renamed from `wallet_grantPermissions` to **`wallet_requestExecutionPermissions`**. A permission is `{chainId, from?, to, permission{type, isAdjustmentAllowed, data}, rules[expiry]}`; the wallet returns an opaque `context` redeemable via an ERC-7710 Delegation Manager. MetaMask ships it as "Advanced Permissions" (ERC-20 and native-token permissions) in the standard extension (v13.23.0+), having moved out of Flask.

### Cited Findings
- ERC-7715 "Request Permissions from Wallets": Status Draft, created 2024-05-24; authors include Luka Isailovic, Derek Rein, Dan Finlay, Derek Chiang, Conner Swenberg, Lukas Rosario; requires EIP-4337 and EIP-7710 — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- **Naming flag:** the current EIP text defines `wallet_requestExecutionPermissions`, `wallet_revokeExecutionPermission`, `wallet_getSupportedExecutionPermissions`, `wallet_getGrantedExecutionPermissions`; it does not define `wallet_grantPermissions` — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- Request fields: `chainId`; optional `from` (user may pick account if omitted); `to` — "a field that identifies the DApp session account associated with the permission"; `permission` = `{type (e.g. "native-token-allowance"), isAdjustmentAllowed, data}`; optional `rules` = `[{type, data}]`, the only defined rule being `expiry` with `data.timestamp` — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- Response echoes the (possibly wallet-modified) request plus `context` (opaque hex used to redeem/revoke), `dependencies` (`factory`/`factoryData` for undeployed accounts), `delegationManager` (contract to redeem against) — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- Security section: "Wallets MUST clearly display the permissions to users" and should warn against dangerous ones — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- ERC-7715 still Draft "as of April 2026" — **[secondary]** [Eco: ERC-7715 explained](https://eco.com/support/en/articles/11953354-erc-7715-explained-wallet-permissions-sessions-and-subscriptions); confirmed Draft on the EIP page as of 2026-10-26 — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- MetaMask "Advanced Permissions (ERC-7715)": supports ERC-20 and native-token permissions (example: 10 USDC/day for a month); user sees a human-readable confirmation with start time, amount, period, and can edit parameters if the request allows; requires MetaMask v13.23.0+ and the user being upgraded to a MetaMask smart account; session account redeems per ERC-7710 — [MetaMask: Advanced Permissions](https://docs.metamask.io/smart-accounts-kit/concepts/advanced-permissions.md)
- Older docs required MetaMask **Flask** 13.5.0+, newer (Smart Accounts Kit 1.7.0) require regular MetaMask 13.23.0+ — i.e. moved from beta build to mainline — [MetaMask Smart Accounts Kit 1.1.0 scaffold page](https://docs.metamask.io/smart-accounts-kit/1.1.0/get-started/use-scaffold-eth/advanced-permissions.md); [1.7.0 concept page](https://docs.metamask.io/smart-accounts-kit/1.7.0/concepts/advanced-permissions.md)
- The toolkit was renamed from "Delegation Toolkit" to "Smart Accounts Kit"; ERC-7715 wallet client methods added in 1.2.0 — [MetaMask Smart Accounts Kit changelog 1.2.0](https://docs.metamask.io/smart-accounts-kit/1.2.0/changelog/1.0.0.md)
- A third-party hackathon report found the earlier 7715 snap allowed only a fixed list of permission types and no custom caveat enforcers (likely outdated) — **[secondary, dated]** [HackQuest project](https://hackquest.io/projects/contenhash-publisher)

### Inferences
- `wallet_grantPermissions` (the name in the research brief and in many 2024–2025 write-ups) appears to be an earlier name for the method; earlier draft text was not fetched to confirm.
- `isAdjustmentAllowed` (spec) and "user can edit parameters" (MetaMask UI) are the same mechanism: the granted permission may differ from what the dApp/agent requested, so the verifier must read the returned/granted terms, not the request.
- Adoption appears concentrated in MetaMask; I found no evidence of Coinbase Wallet, Rainbow, Rabby etc. implementing `wallet_requestExecutionPermissions` (Coinbase co-authors the ERC but ships its own Spend Permissions).

### Gaps
- No primary launch date for MetaMask Advanced Permissions in mainline extension; full permission-type list (periodic/stream variants) on the "supported permissions" page not fetched.
- No adoption metrics (number of permissions granted, dApps integrated) found.

## 3. Agent-wallet platforms and policy engines (Coinbase CDP/AgentKit, Privy, Turnkey, Crossmint, MPC vs smart accounts)

### Takeaway
Embedded/server-wallet vendors (CDP, Privy, Turnkey) enforce agent limits **off-chain in the vendor's policy engine before signing** (key held in MPC/TEE); smart-account approaches (Coinbase Spend Permissions, MetaMask, Safe, Crossmint per one analysis) enforce **on-chain in contract code**. Off-chain policies are richer and mutable by whoever holds admin scope; on-chain policies are publicly auditable but harder to change.

### Cited Findings
- **CDP Wallet Policies:** policies have `scope` (project or account), `rules` [{`action`: accept|reject, `operation`, `criteria`}]; reject beats accept; if a policy has rules for an operation but none match, the request is rejected. Operations include `signEvmTransaction`, `sendEvmTransaction`, `signEvmMessage`, `signEvmTypedData`, `signEvmHash`, `prepareUserOperation`, `sendUserOperation`, Solana equivalents, and end-user variants. Criteria shown: `ethValue` (wei comparison), `evmAddress` (in/not in). Managing policies needs API-key scope "Non-custodial > Manage"; policies can be paused/resumed. Page undated — [CDP: Policies overview](https://docs.cdp.coinbase.com/server-wallets/v2/using-the-wallet-api/policies/overview)
- Coinbase marketing describes enforcement types: address filters, allowlists, value caps, message guards, enforced on every signature request; framed for agents calling only allow-listed contracts and respecting per-address spend caps (page undated) — [Coinbase: CDP Wallet Policies launch](https://www.coinbase.com/es-es/developer-platform/discover/launches/policy-engine)
- "Agentic Wallets" reportedly launched 2026-02-11, MPC-secured, with session caps, per-tx limits, gasless settlement on Base, native x402; AgentKit is the open-source skills framework above the wallet — **[secondary]** [Eco: Coinbase agentic wallets explained](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained)
- **Privy:** two models — agent-owned wallets (agent holds the credential, transacts without prompting a user) and delegated signing (user grants the agent a scoped "authorization key"; "the user can revoke access at any time"). Policies restrict tokens/chains, cap per-tx or per-time-window values, allowlist recipients/contracts; x402/MPP payments with per-request `maxValue`; Agent CLI sessions up to 30 days after one browser approval. Enforcement location not stated on page — [Privy: Agent wallets](https://docs.privy.io/wallets/overview/solutions/agent-wallets); see also [Privy blog: policy engine](https://privy.io/blog/turning-wallets-programmable-with-privy-policy-engine)
- **Turnkey:** policies are JSON with `effect` (`EFFECT_ALLOW`/`EFFECT_DENY`), `consensus` (who), `condition` (when). Evaluation order: (1) **root quorum bypasses all policies**, (2) any applicable DENY wins, (3) any ALLOW allows, (4) implicit deny — [Turnkey: Policies overview](https://docs.turnkey.com/concepts/policies/overview)
- Turnkey runs the policy engine inside the signing enclave — **[secondary]** [Stablecoin Insider: Crossmint vs Privy vs Turnkey](https://stablecoininsider.org/crossmint-vs-privy-vs-turnkey-for-agent-wallets/)
- **Crossmint:** permissions are a property of the smart-wallet contract (signer must be installed on-chain), making them externally auditable but less flexible — **[secondary, only source found]** [Stablecoin Insider](https://stablecoininsider.org/crossmint-vs-privy-vs-turnkey-for-agent-wallets/)

### Inferences
- MPC/TEE policy engines are architecturally similar to PayPal's model: the consent/limit lives in a vendor database the vendor (or customer admin / root quorum) can edit, pause, or delete, and third parties cannot independently verify the policy that was in force at a given time.
- Turnkey's root-quorum bypass and CDP's "Manage" scope mean the developer/operator, not the end user, ultimately controls these limits — the opposite of a user-signed consent record.

### Gaps
- Dynamic and Fireblocks agent-wallet policy engines not researched (call budget).
- Crossmint primary docs on spending limits not found.
- Whether CDP and Privy policies are evaluated in a TEE, and whether either exposes a policy audit/history log, not confirmed from primary docs.
- No primary Coinbase announcement of "Agentic Wallets" (Feb 2026) fetched.

## 4. Is the consent record immutable and publicly verifiable? What happens after revocation? (vs. a deletable custodial record)

### Takeaway
It depends sharply on design. **Coinbase Spend Permissions** is the strongest case: approval and revocation are both on-chain events, revocation is permanent (`_isRevoked` never cleared; the same permission can never be re-approved), and every spend emits a log tied to the permission hash. **ERC-7710/MetaMask delegations** are signed **off-chain** and "can be stored anywhere"; only redemption and `disableDelegation` touch the chain, so the consent itself is not publicly visible until used. **Safe Allowance** lives in contract storage but `deleteAllowance`/`removeDelegate` erase current state. **Vendor policy engines** (CDP/Privy/Turnkey) are custodial-style, mutable records.

### Cited Findings
- Coinbase: `SpendPermissionApproved(bytes32 indexed hash, SpendPermission)` emitted once on first approval; `SpendPermissionRevoked(bytes32 indexed hash, SpendPermission)` emitted once on first revocation; `SpendPermissionUsed(hash, account, spender, token, periodSpend)` on every spend — [SpendPermissionManager.sol](https://raw.githubusercontent.com/coinbase/spend-permissions/main/src/SpendPermissionManager.sol)
- Coinbase: state in mappings keyed by permission hash (`_isApproved`, `_isRevoked`, `_lastUpdatedPeriod`); `_revoke` sets `_isRevoked[hash] = true` and does not clear `_isApproved`; `_approve` returns early if revoked, so a revoked permission can never be re-approved. Both account (`revoke`) and spender (`revokeAsSpender`) can revoke — [SpendPermissionManager.sol](https://raw.githubusercontent.com/coinbase/spend-permissions/main/src/SpendPermissionManager.sol)
- Coinbase: user-initiated revoke via SDK `requestRevoke` requires interaction in the Coinbase Wallet UI — [CDP docs: requestRevoke](https://docs.cdp.coinbase.com/coinbase-wallet/reference/spend-permission-utilities/requestRevoke.md)
- MetaMask: delegations "are created offchain and can be stored anywhere"; revocation = `DelegationManager.encode.disableDelegation({delegation})` sent on-chain; afterwards any redemption reverts — [MetaMask: Disable a delegation](https://docs.metamask.io/smart-accounts-kit/guides/delegation/disable-delegation/)
- ERC-7710 leaves the storage of `_permissionContexts` to the Delegation Manager implementation and specifies no revocation mechanism; dApps should simulate redemption since "past delegations do not guarantee future rights" — [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710)
- ERC-7715: `wallet_revokeExecutionPermission(permissionContext)`; `wallet_getGrantedExecutionPermissions` returns only non-revoked permissions (a wallet-side view, not a chain record) — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- Safe: `deleteAllowance` removes one token's allowance; `removeDelegate` removes the delegate and all its allowances — [safe-modules/allowances](https://github.com/safe-global/safe-modules/tree/main/modules/allowances)
- CDP: policies can be paused/resumed by holders of "Non-custodial > Manage" scope; page says nothing about history/audit logs — [CDP: Policies overview](https://docs.cdp.coinbase.com/server-wallets/v2/using-the-wallet-api/policies/overview)

### Inferences
- Ethereum event logs are part of transaction receipts and are not removed by later state changes, so for Coinbase Spend Permissions the full permission struct (in `SpendPermissionApproved`), the revocation, and every use remain publicly reconstructable after revocation, by anyone, without the wallet vendor's cooperation. (General EVM property; no single source fetched states it — treat as well-known background.)
- Safe's deletion clears contract storage, but the `setAllowance` transaction calldata stays in chain history, so a determined verifier can still reconstruct it from transaction history even though current state is gone.
- For ERC-7710 delegations, the redemption transaction carries the signed delegation in `_permissionContexts`, so the consent becomes public and permanent **at the moment of first use** — an unused consent stays private.
- Contrast for Readback: Readback's own spike (repo `docs/decisions/0001-sandbox-spike.md`, commit 039e41e) records that a PayPal unauthorized claim deletes the vault agreement. A custodial processor can delete the consent record; Coinbase's on-chain design makes revocation additive (a new flag + event), never destructive.

### Gaps
- No primary source fetched that explicitly documents event-log permanence or whether Safe's Allowance Module emits events on set/delete.
- Whether MetaMask's `disableDelegation` emits an event (and its name) not confirmed.

## 5. Does any scheme bind a specific agent key to the user's approval, and is it shown at approval time?

### Takeaway
Yes, all on-chain schemes bind a specific agent address/key into what the user signs: Coinbase's `spender` is inside the EIP-712 typehash; ERC-7715's `to` names the session account; Smart Sessions require a `sessionPublicKey`; Safe keys allowances by delegate address. **Whether the wallet UI actually displays that agent address/key at approval time is not documented** by any source I found — MetaMask's docs mention start time, amount and period only.

### Cited Findings
- Coinbase: `SPEND_PERMISSION_TYPEHASH` and the batch `PERMISSION_DETAILS_TYPEHASH` both include `address spender`, so the signed approval is bound to one spender address — [SpendPermissionManager.sol](https://raw.githubusercontent.com/coinbase/spend-permissions/main/src/SpendPermissionManager.sol)
- ERC-7715: `to` "identifies the DApp session account associated with the permission"; the term "session key" is not used in the spec — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- Biconomy Smart Sessions: `sessionPublicKey` required for K1 validators — [Biconomy: Smart Session Policies](https://docs.biconomy.io/new/smart-sessions/policies)
- ZeroDev: each permission has exactly one signer (ECDSA, passkey, or multisig) — [ZeroDev: Permissions intro](https://docs.zerodev.app/sdk/permissions/intro)
- Safe: allowances keyed by `delegate`; transfers require the delegate's EIP-712 signature — [safe-modules/allowances](https://github.com/safe-global/safe-modules/tree/main/modules/allowances)
- Privy delegated signing issues the agent a scoped "authorization key" — [Privy: Agent wallets](https://docs.privy.io/wallets/overview/solutions/agent-wallets)
- MetaMask approval screen shows start time, amount, period duration (editable if allowed); the doc does not say the session account address is shown — [MetaMask: Advanced Permissions](https://docs.metamask.io/smart-accounts-kit/concepts/advanced-permissions.md)

### Inferences
- These schemes bind an **address** (a hash of a public key), not a human-readable fingerprint. Even if shown, a 0x address is effectively unverifiable by a shopper — analogous to Readback's grouped key fingerprint shown in PayPal's approval page `billing_plan.name`.
- None of the on-chain schemes binds per-purchase intent (item, merchant order) — the spender can spend any amount up to the cap to any recipient (Coinbase: recipient is a `spend()` argument, not a permission field). A per-purchase signed mandate (as in Readback / AP2) is a layer these don't provide natively.

### Gaps
- No screenshots or docs of Coinbase Smart Wallet's or MetaMask's approval UI showing whether `spender`/`to` is displayed; flagged as unverified.
- No scheme found that displays a key fingerprint (vs. address) to the user.

## 6. Known failure modes: blind signing, permit phishing, over-broad approvals, prompt-injection drains

### Takeaway
Signature phishing (Permit/approval/EIP-7702 delegation signatures) remains the dominant user-side loss vector even as totals fell in 2025 ($83.85M vs ~$494M in 2024); the Bybit theft (Feb 2025, ~$1.5B) is the canonical blind-signing case; and the Grok/Bankrbot drain (May 4, 2026, ~$150–200K) is the canonical prompt-injection agent-wallet incident, which exploited agent permissions, not cryptography.

### Cited Findings
- Scam Sniffer 2025 annual report: $83.85M lost across 106,106 victims, down 83% (value) and 68% (victims) vs 2024; Q3 peak ~$31M, Q4 ~$13M; figures are a lower bound (trackable EVM drainer activity only) — [Scam Sniffer 2025 report](https://drops.scamsniffer.io/scam-sniffer-2025-crypto-phishing-losses-fall-83-to-84-million/). 2024 total ~$494M — [MEXC news](https://www.mexc.com/news/405173)
- Largest single 2025 theft: $6.5M (stETH, aEthWBTC) via a Permit signature in September 2025 — [The Block: Operation Atlantic](https://www.theblock.co/post/393746/us-secret-service-uk-and-canada-launch-operation-atlantic-targeting-crypto-approval-phishing-scams)
- New vector: malicious EIP-7702 signatures after the Pectra upgrade, two large cases in August 2025 — [Scam Sniffer](https://drops.scamsniffer.io/?p=1115)
- Single Permit signature cost one user ~$440K USDC on 2025-12-08 — [MEXC news](https://www.mexc.com/news/250002); signature phishing up 200% in January 2026 with losses >$6M — [Decrypt](https://decrypt.co/357450/signature-phishing-up-200-as-january-losses-pass-6m)
- US Secret Service, UK and Canada launched "Operation Atlantic" targeting approval-phishing scams — [The Block](https://www.theblock.co/post/393746/us-secret-service-uk-and-canada-launch-operation-atlantic-targeting-crypto-approval-phishing-scams)
- Bybit (February 2025; exact day not confirmed from fetched sources; ~$1.4–1.5B): FBI attributed to North Korea's TraderTraitor/Lazarus — [Security Affairs](https://securityaffairs.com/174735/cyber-crime/fbi-north-korea-responsible-bybit-hack.html). Safe said a compromised Safe{Wallet} developer machine proposed a "disguised malicious transaction"; contracts/source not compromised — [The Block](https://www.theblock.co/post/343530/lazarus-appears-to-compromise-safe-developer-machine-in-lead-up-to-1-5-billion-bybit-hack-report). SlowMist found tampered Safe front-end JS altered the transaction during signing — [SlowMist](https://slowmist.medium.com/bybits-1-5-billion-theft-unveiled-safe-wallet-front-end-code-tampered-84b78f0fa9c2). **Conflict:** some write-ups say a signer did not fully verify on his Ledger (blind signing), while The Block reported Bybit's own signing devices were not directly implicated — [Onramp (vendor blog, secondary)](https://onrampbitcoin.com/knowledge-center/how-was-bybit-hacked) vs [The Block](https://www.theblock.co/post/343530/lazarus-appears-to-compromise-safe-developer-machine-in-lead-up-to-1-5-billion-bybit-hack-report)
- Grok/Bankrbot drain, reported 2026-05-04: attacker posted a Morse-code-encoded instruction on X; Grok/Bankrbot decoded and transferred ~3B DRB tokens (~$150–200K; OECD estimates $155–180K) from a verified wallet on Base; exploit relied on AI input interpretation, not smart-contract flaws — [OECD AI Incidents Monitor](https://oecd.ai/en/incidents/2026-05-04-4a73); attacker reportedly first sent a Bankr Club Membership NFT that unlocked advanced tool permissions — [AMBCrypto](https://ambcrypto.com/ai-linked-wallet-drained-via-prompt-injection-in-bankr-exploit/); [Cointelegraph](https://cointelegraph.com/magazine/grok-bankr-wallet-free-nft-prompt-injection); classified as OWASP LLM prompt injection + excessive agency — [Giskard (May 7, 2026)](https://giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet); also [AI Incident Database #1556](https://incidentdatabase.ai/cite/1556/)
- Over-broad approvals by design: MetaMask warns a delegation without caveat enforcers has "infinite and unbounded authority" — [MetaMask: caveat enforcers](https://docs.metamask.io/delegation-toolkit/concepts/caveat-enforcers); Biconomy `sudo` and ZeroDev Sudo policy grant unrestricted session use — [Biconomy](https://docs.biconomy.io/new/smart-sessions/policies); [ZeroDev](https://docs.zerodev.app/sdk/permissions/intro)
- ERC-7715 requires wallets to "clearly display the permissions" and warn on dangerous ones (a spec-level mitigation against blind approval) — [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)

### Inferences
- The failure modes split in two: (a) the human signs something they can't read (Permit/7702/Bybit), and (b) the agent is talked into a spend its keys allow (Grok/Bankr). On-chain caps limit (b)'s blast radius but say nothing about whether a specific spend was what the user wanted — the "my AI bought that" dispute problem remains even with perfect on-chain limits.
- On-chain transfers are final; none of these schemes has a dispute or chargeback path. A spend within a valid Spend Permission is final regardless of whether the user later disowns it.

### Gaps
- No incident found specifically involving a Coinbase Spend Permission, an ERC-7715 permission, or a session-key module being abused (searched only briefly).
- Bybit primary post-mortems (Bybit's own, Sygnia full report) not fetched; signer-device detail remains disputed.
- No 2026 full-year phishing totals (year in progress).
