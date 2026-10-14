# 0002 — Group fingerprints with spaces, not dashes

Status: accepted (2026-10-15). Display only; the stored terms string is unchanged.

**Context.** The agent fingerprint is the first 16 characters of a base64url thumbprint. The base64url alphabet includes `-` and `_`. SPEC §4.1 grouped it for display as `qX7m-P2vL-9cRt-4sYb`. A real generated key produced `-TJ7jbI7FwjvYh2f`, which that rule displays as `-TJ7-jbI7-Fwjv-Yh2f`: nobody can tell separators from content.

**Why it matters.** Maya comparing her runtime's fingerprint with PayPal's approval page is the only defense against a merchant swapping in its own key at setup (THREAT-MODEL T21). The comparison must be unambiguous.

**Decision.** Display as four groups of four separated by spaces, in monospace: `-TJ7 jbI7 Fwjv Yh2f`. PayPal's page shows the ungrouped string inside the terms (`agent -TJ7jbI7FwjvYh2f`), so the comparison is group-by-group against a contiguous string.

**Consequences.** `groupFingerprint` in `readback-core` changed; SPEC §4.1 and THREAT-MODEL T21 updated. No format-freeze impact.
