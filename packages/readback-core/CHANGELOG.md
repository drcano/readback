# Changelog

## 0.1.0 (unreleased)

First release.
- Terms grammar, `termsHash`, period math and integer-cent money.
- ES256 closed mandates: sign, verify (pinned `ES256`, exact-header hygiene) and match against terms; RFC 7638 fingerprints.
- `invoice_id` and `custom_id` labels, and the checkout gate decision (`authorizeCharge`).
- The eleven case checks, the four lights and the classification table, with labeled fixture cases.
- AP2 v0.2 payment-mandate import.
- Mastercard Verifiable Intent (Draft v0.1) chain check: `evaluateViChain`, with VI's own example chain as a fixture.
- Pure and browser-safe: no Node-only APIs.
