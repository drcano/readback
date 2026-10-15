# 0002 — Group fingerprints with spaces, not dashes

Status: accepted (2026-10-15). Display only; the stored terms string is unchanged.

**Context.** The agent fingerprint is the first 16 characters of a base64url thumbprint. The base64url alphabet includes `-` and `_`. SPEC §4.1 grouped it for display as `qX7m-P2vL-9cRt-4sYb`. A real generated key produced `-TJ7jbI7FwjvYh2f`, which that rule displays as `-TJ7-jbI7-Fwjv-Yh2f`: nobody can tell separators from content.

**Why it matters.** Maya comparing her runtime's fingerprint with PayPal's approval page is the only defense against a merchant swapping in its own key at setup (THREAT-MODEL T21). The comparison must be unambiguous.

**Decision.** Display as four groups of four separated by spaces, in monospace: `-TJ7 jbI7 Fwjv Yh2f`. ~~PayPal's page shows the ungrouped string inside the terms~~ Corrected by the spike (2026-10-15, step 2): PayPal's page shows only `billing_plan.name`, never the stored `description`. The plan name now ends with the **grouped** fingerprint (`…, agent -TJ7 jbI7 Fwjv Yh2f`), so both sides of Maya's comparison use the same grouping.

**Consequences.** `groupFingerprint` in `readback-core` changed; SPEC §4.1 and THREAT-MODEL T21 updated. No format-freeze impact.

**Update, 2026-10-15 (spike step 2).** PayPal rejects `_` in plan names, and base64url fingerprints can contain it, so `generateAgentKey` draws keys until the fingerprint has no `_` (about 78% of keys qualify). The plan name is merchant-supplied and not stored, so the comparison on PayPal's page can't prove which fingerprint is in `description`; THREAT-MODEL T21 states that limit.

**Update, 2026-10-15 (hero approval page).** PayPal's page uses a proportional sans-serif in which `I` and `l` are indistinguishable: the first production fingerprint, `zSQh Kgd0 RiXK Iibh`, rendered as "…libh" ([screenshot](assets/0001-approval-page-plan-name.png)). Keys are now drawn until the fingerprint has no `_`, `I` or `l` (about 36% qualify). The first production key and its agreement were replaced the same day, before any history depended on them.
