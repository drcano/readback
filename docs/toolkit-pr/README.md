# Disputes: submit evidence, verify agent purchases, fix `accept_dispute_claim`

Base: `v1.11.0`. TypeScript package only; the `python/` package is unchanged (no parity port in this PR).

## What

1. **Fix two `accept_dispute_claim` bugs** (reproduced with failing tests first):
   - `note` was validated with `DISPUTE_ID_REGEX` (`^[A-Za-z0-9_-]{1,255}$`), so any real note (a space, a comma, a period) was rejected with the misleading error "Invalid PayPal Dispute ID". Meanwhile `dispute_id` had no validation at all; the regex was on the wrong field. Now `dispute_id` uses `DISPUTE_ID_REGEX` and `note` is 1–2000 characters, the bound PayPal's Disputes spec uses for every note field.
   - The tool's params were passed to axios as `params`, so the POST went to `.../accept-claim?dispute_id=...&note=...`, putting the merchant's note in the URL (and in any proxy or access log). The call now sends the note only in the body.
2. **New tool `provide_dispute_evidence`.** Today the toolkit can list, get and accept disputes, but it can't defend one. The tool:
   - GETs the dispute first and follows its own HATEOAS `links`: `provide_evidence` if offered, otherwise `provide_supporting_info`. If neither is offered it fails with `DISPUTE_ACTION_NOT_OFFERED` and lists what PayPal does offer. In Readback's sandbox spike, a dispute under PayPal review offered only `provide_supporting_info`, and `provide-evidence` returned `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`; `provide-supporting-info` with a multipart `input` part returned 200. That observation comes from Readback's own client. This PR's code has not been run against the sandbox; its multipart wire format was checked against a local HTTP server and in unit tests.
   - POSTs `multipart/form-data` with an `input` JSON part: `{ evidences: [{ evidence_type, notes }] }` for provide-evidence, `{ notes }` for supporting info. The result names the action used, since the fallback drops `evidence_type`.
   - Restricts `evidence_type` to the 76 values in `customer_disputes_v1.json` (`components.schemas.evidence.properties.evidence_type`). Values that aren't in that list, such as `PROOF_OF_AUTHORIZATION`, are rejected.
   - Drops the `Content-Type: application/json` header that `getHeaders()` sets. Otherwise axios 1.x serializes a `FormData` body to JSON instead of sending multipart.
   - Accepts optional `documents` (`{ name, content_type, content_base64 }`), attached as file parts named as in the spec's request bodies (`evidence-file`, `supporting document`).
3. **New tool `verify_agent_purchase`.** Given a dispute ID or a capture ID, it rebuilds an AI-agent purchase from PayPal's own records (dispute → capture → order → vault payment token) and returns a verdict: did the shopper's approved agent key sign this request, and was the charge within the terms she approved on PayPal? The toolkit side is deliberately thin:
   - The verifier is injected as `context.agentPurchaseVerifier(id, { get }, now)`.
   - `get(path, schema?)` is a read-only GET over the toolkit's authenticated HTTP layer. It returns `{ ok, status, data | issues, debugId }` and never throws, so the verifier can fail closed.
   - Only relative paths are accepted (`/...`, not `//...` or `@host`), so a verifier can't send the bearer token to another host.
   - The tool is listed only when a verifier is configured, so existing `disputes: { get: true }` configurations don't get a tool that can only fail.
   - The intended verifier is `verifyCase` from `@readback/verify@^0.1.0` (Readback, Apache-2.0), which isn't published yet. See TODO below.

## Why

AI agents are starting to buy things with saved PayPal wallets. When a buyer later disputes with "my AI bought that", the merchant needs two things: a way to tell an authorized agent purchase from an unauthorized one, using records PayPal already holds, and a way to put that answer on the dispute. This PR adds both, plus fixes the one dispute write tool the toolkit already had.

## Bug reproduction (before the fix)

Commit `test(disputes): reproduce two accept_dispute_claim bugs` adds the tests alone. On that commit, `npm test` gives:

```
FAIL src/shared/__tests__/acceptDisputeClaim.test.ts
  accept_dispute_claim
    ✕ accepts an ordinary note (spaces and punctuation)
    ✕ sends dispute_id and note only in the path and body, never in the query string

  ● accept_dispute_claim › accepts an ordinary note (spaces and punctuation)
    Received: [{"code": "invalid_string", "message": "Invalid PayPal Dispute ID", "path": ["note"], "validation": "regex"}]

  ● accept_dispute_claim › sends dispute_id and note only in the path and body, never in the query string
    Expected: "https://api.sandbox.paypal.com/v1/customer/disputes/PP-D-12345/accept-claim"
    Received: "https://api.sandbox.paypal.com/v1/customer/disputes/PP-D-12345/accept-claim?dispute_id=PP-D-12345&note=Refunding"

Tests:       2 failed, 2 total
```

The URL is computed with `axios.getUri({ url, params })` from the config the function actually passed to `axios.post`.

## Tests

```
cd typescript
npm install
npm test          # jest: 3 suites, 14 tests
npm run typecheck # tsc --noEmit
npx tsup          # the build step of `npm run build`
```

Notes on tooling:
- At `v1.11.0`, `npm test` was `exit 1` and there were no TypeScript tests, even though `jest.config.ts` and ts-jest were already set up. This PR sets `"test": "jest"`, adds a `typecheck` script, and runs ts-jest with `diagnostics: false`. That matches tsup, which also builds without type-checking, and is needed because `src/shared/payloadUtils.ts` has 4 pre-existing type errors that would otherwise fail every suite. `tsc --noEmit` reports 15 errors both before and after this PR, all pre-existing (in `payloadUtils.ts` and `examples/`). This PR adds none.
- The repo has no lint configuration, so no lint step ran.

## Not in this PR / follow-ups

- **TODO `@readback/verify@^0.1.0`:** once it's published, the default verifier becomes `(id, paypal, now) => verifyCase(id, paypal, now)`. That package is ESM-only and needs Node ≥ 22.18, while this package also ships CJS targeting node18, so it would be loaded with a dynamic `import()` (or kept as an opt-in injection, as it is now).
- **Document uploads are untested in sandbox.** Notes-only submissions match what was verified against the sandbox. Two things are unconfirmed: the file part names (taken from the OpenAPI request bodies) and whether `input.evidences[].documents[{ name }]` must also list the files.
- **Idempotency:** `provide_dispute_evidence` uses `context.request_id` like every other tool. A deterministic per-submission `PayPal-Request-Id` would make retries safe; that would be a toolkit-wide change.
- **The same `{ headers, params }` pattern is in `listDisputes`.** It's a GET, so the params are meant to be in the query, but they're added twice: once by `toQueryString` in the URL and once by axios. Not changed here.
- `CHANGELOG.md` was not updated (its latest entry is 1.3.5; releases are versioned by CI).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
