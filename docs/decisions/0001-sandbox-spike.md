# 0001 — Day-one sandbox spike (go/no-go)

Status: in progress (started 2026-10-14)

Each row is filled from a real sandbox run. Failures are recorded, not hidden.

| # | Check | Script | Result | Notes |
|---|---|---|---|---|
| 1 | OAuth + Orders, `custom_id` round-trips on GET (must pass) | `scripts/spike/01-orders.ts` | pending | |
| 2 | Vault: setup token → approve → payment token → charge, buyer absent | | pending | Fallback: human-present |
| 3 | Disputes: create via API | | pending | Fallback: buyer opens in UI |
| 4 | Lifecycle: require-evidence → provide-evidence → adjudicate | | pending | |
| 5 | Webhooks: verify `CUSTOMER.DISPUTE.CREATED` | | pending | Needs tunnel or Render deploy |
| 6 | `send-message` at INQUIRY | | pending | |

## Decision

TBD once rows 1–3 are in.
