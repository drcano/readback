# 0001 — Sandbox spike (go/no-go)

Status: in progress (started 2026-10-14). Public record, linked from the README.

Each row is filled from a real sandbox run against a **standard merchant REST app** (not a platform app). Failures are recorded, not hidden. Scrubbed responses are saved under `evals/fixtures/spike/`. Steps are defined in `docs/SPEC.md` §8.

| # | Step | Go/no-go | Script | Result | Fixtures |
|---|---|---|---|---|---|
| 1 | Orders basics: every Readback field round-trips on GET | **yes** | `scripts/spike/01-orders.ts` | pending | `01-*.json` |
| 2 | Agreement with terms: setup token → approval → payment token; `description` round-trips | **yes** | | pending | |
| 3 | Charge without the shopper; order echoes `attributes.vault.id` | **yes** | | pending | |
| 4 | Duplicate-period guard (`DUPLICATE_INVOICE_ID`), request-ID replay | **yes** | | pending | |
| 5 | Revocation: merchant DELETE, buyer-side cancel, webhooks | no | | pending | |
| 6 | History: Transaction Search, `:` in `custom_field`, lag | no | | pending | |
| 7 | Disputes: UI-opened, lifecycle to `adjudicate` | **yes** | | pending | |
| 8 | Tracking: `/track` round-trips | no | | pending | |
| 9 | Crypto (ES256 + thumbprint, Node and browser) / connector | **crypto: yes** | | pending | |

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

## Step 1 — Orders basics

Pending first run. Will record: every PASS/FAIL line, the retained length of `items[0].description`, whether the capture carries `custom_id`/`invoice_id`, `seller_protection`, the capture → order link, and what the buyer's receipt shows.

## Decision

TBD once the go/no-go rows are in.
