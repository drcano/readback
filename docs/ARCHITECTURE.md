# Architecture: PayPal is the system of record

Readback stores nothing. Every fact it uses lives in PayPal; every decision is deterministic code in `packages/readback-core` that runs the same on the server and in the browser.

## Components and trust

```mermaid
flowchart LR
  subgraph Maya["Maya's side"]
    A["Assistant<br/>(any MCP client: Claude)"] -- "MCP tools" --> R["Agent runtime<br/>apps/agent<br/>holds the P-256 agent key<br/>no PayPal credentials"]
  end
  subgraph Merchant["Merchant's Readback deployment (apps/web)"]
    G["Checkout gate<br/>verify → decide → charge"]
    I["Investigator queue & case view<br/>re-verify in the browser"]
    W["Webhooks<br/>verified with PayPal first"]
  end
  subgraph PayPal["PayPal (system of record)"]
    T[("Payment token<br/>approved terms + agent fingerprint")]
    O[("Order + capture<br/>signed mandate, labels, payer")]
    D[("Dispute")]
  end
  R -- "signed closed mandate (ES256 JWS)" --> G
  G -- "GET terms" --> T
  G -- "create order with vault_id, invoice_id" --> O
  I -- "read" --> D & O & T
  W -. "look again" .-> I
  C["@readback/verify CLI<br/>same checks, merchant API credentials"] -- "read" --> D & O & T
```

- **Claude never decides.** It drafts terms (validated, then confirmed by Maya), writes a cited brief (validated), and maps a queue question to a named filter. Allow/deny and every suggestion come from `readback-core`.
- **Keys.** Only the agent runtime holds a private key. The merchant app and the investigator only verify. Judge mode's in-tab key is non-extractable and lives only in that tab (THREAT-MODEL T31).

## One purchase, end to end

```mermaid
sequenceDiagram
  participant M as Maya
  participant A as Assistant
  participant R as Agent runtime
  participant G as Checkout gate
  participant P as PayPal
  M->>P: approves terms on PayPal's page (fingerprint shown)
  P-->>G: payment token (terms in description, immutable)
  A->>R: request_reorder(agreement, sku, qty)
  R->>G: GET /api/agreements/{id} (terms)
  R->>R: terms carry MY fingerprint? request inside terms? else refuse
  R->>G: POST /api/checkout {signed mandate}
  G->>G: verify ES256, exact header, freshness
  G->>P: GET payment token (still active?)
  G->>G: fingerprint, terms hash, item, qty, cap, dates, period, catalog price
  G->>P: POST order (vault_id, invoice_id RB-…-P###, custom_id, mandate in item)
  P-->>G: COMPLETED, or DUPLICATE_INVOICE_ID (already ordered this period)
```

## A dispute, end to end

```mermaid
flowchart TD
  D["Dispute (PayPal)"] --> S["seller_transaction_id"] --> C["Capture"] --> O["Order"]
  O --> V["Agreement named by custom_id / invoice_id<br/>(PayPal sends no vault echo; confirmed by PayPal's payer match)"] --> T["Payment token → approved terms"]
  O --> J["Signed mandate in items[0].description"]
  T & J & O & C --> K["Eleven checks<br/>Consent · Agent · Terms · Delivery"]
  H["Transaction Search history<br/>+ per-charge dispute status"] --> K
  K --> X["Classification (first matching row)"] --> Y{"Suggestion"}
  Y -->|"signed, in terms, delivered, history"| SF["Seller's favor"]
  Y -->|"unsigned, outside terms, after cancel, not shipped"| BF["Buyer's favor"]
  Y -->|"evidence can't separate the sides"| N["No suggestion → PayPal review"]
```

The chain is followed through PayPal, never through merchant labels; labels are cross-checks. Merchant-written evidence can count against the merchant but never earns a seller-side suggestion (ADR 0004).

## Where each rule lives

| Rule | File |
|---|---|
| Terms grammar, canonical form, ≤127 chars | `packages/readback-core/src/terms.ts` |
| Money as integer cents | `money.ts` |
| ES256 compact JWS, exact header members | `jws.ts` |
| Agent fingerprint (RFC 7638) | `thumbprint.ts` |
| Closed mandate: verify, fit the terms, freshness, pre-check before signing | `mandate.ts` |
| Gate decision and the exact Orders request body | `gate.ts` |
| Labels (`invoice_id`, `custom_id`) and deterministic request IDs | `ids.ts` |
| The eleven checks | `checks.ts` |
| Classification and modifiers | `classify.ts` |
| Four lights | `lights.ts` |
| Action proofs (revoke, demo direct charge) | `action.ts` |
| Setup-token request (terms + display-only plan) | `setup.ts` |
| Reading a case from PayPal | `packages/verify-cli/src/cases.ts` |
| Agent runtime tools | `apps/agent/src/runtime.ts` |

## Verification

| What | How |
|---|---|
| Unit and property tests | `pnpm test` (core ~98% coverage; 10,000-mutation tamper property) |
| Same code in a real browser | `pnpm test:browser` (headless Chromium) |
| Labeled scenarios | `pnpm eval`, or `/judge` in the browser |
| Real server, browser, PayPal fake | `pnpm --filter @readback/web test:e2e` (judge flow + axe-core, light and dark) |
| Real PayPal behaviour | the public spike record, `docs/decisions/0001-sandbox-spike.md` |
