# Changelog

## 0.1.0 (unreleased)

First release.
- `npx @readbackhq/verify <disputeId|captureId>`: rebuilds the case from PayPal (dispute → capture → order → agreement, plus Transaction Search history) and prints the eleven checks and the classification.
- Typed PayPal REST client: deterministic `PayPal-Request-Id` on every POST, a 25 s timeout with one same-ID retry, zod-parsed responses.
- An in-memory PayPal fake (`@readbackhq/verify/fake`) for tests.
