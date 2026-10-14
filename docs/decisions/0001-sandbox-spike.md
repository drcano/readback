# 0001 — Sandbox spike (go/no-go)

Status: in progress (started 2026-10-14). Public record, linked from the README.

Each row is filled from a real sandbox run against a **standard merchant REST app** (not a platform app). Failures are recorded, not hidden. Scrubbed responses are saved under `evals/fixtures/spike/`. Steps are defined in `docs/SPEC.md` §8.

| # | Step | Go/no-go | Script | Result | Fixtures |
|---|---|---|---|---|---|
| 1 | Orders basics: every Readback field round-trips on GET | **yes** | `scripts/spike/01-orders.ts` | pending | `01-*.json` |
| 2 | Agreement with terms: setup token → approval → payment token; `description` round-trips | **yes** | `02-agreement.ts` | pending | `02-*.json` |
| 3 | Charge without the shopper; order echoes `attributes.vault.id` | **yes** | `03-vault-charge.ts` | pending | `03-*.json` |
| 4 | Duplicate-period guard (`DUPLICATE_INVOICE_ID`), request-ID replay | **yes** | `04-duplicate-guard.ts` | pending | `04-*.json` |
| 5 | Revocation: merchant DELETE, buyer-side cancel, webhooks | no | `05-revocation.ts` | pending | `05-*.json` |
| 6 | History: Transaction Search, `:` in `custom_field`, lag | no | `06-history.ts` | pending | `06-*.json` |
| 7 | Disputes: UI-opened, lifecycle to `adjudicate` | **yes** | `07-disputes.ts` | pending | `07-*.json` |
| 8 | Tracking: `/track` round-trips | no | `08-tracking.ts` | pending | `08-*.json` |
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
- Not yet tested: the Claude connector calling the runtime (needs the MCP runtime, week 2).

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
14. `pnpm seed:charge` on Oct 21, 23 and 28 at minimum, then daily from Nov 1 as needed.

Fixtures from step 3 on are signed with throwaway keys that don't match step 2's terms fingerprint, and their order bodies are built by hand: they record **what PayPal stores and returns**, not product-shaped cases. **Product-shaped fixtures for `readback-core` and the evals come from `pnpm seed:charge`**, which signs with the real agent key and charges through core's `authorizeCharge`; it saves each order as `evals/fixtures/spike/seed-<invoice_id>-order.json`.

## Step 1 — Orders basics

Pending first run. Will record: every PASS/FAIL line, the retained length of `items[0].description`, whether the capture carries `custom_id`/`invoice_id`, `seller_protection`, the capture → order link, and what the buyer's receipt shows.

## Decision

TBD once the go/no-go rows are in.
