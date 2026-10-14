# Readback

**The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.**

> Work in progress for the PayPal AI Hackathon (submission Nov 12, 2026). Runs against the PayPal **sandbox** only. Sandbox behaviour Readback depends on is being verified step by step in the public [spike record](docs/decisions/0001-sandbox-spike.md); anything not yet confirmed there is marked *pending*.

Maya tells her AI once what it may buy. PayPal holds that promise, her agent signs every purchase, and when anyone says "my AI bought that," the truth takes one click.

**Same claim, two verdicts.** A signed, in-terms purchase that Maya disowns → the evidence supports the **seller**. A charge the merchant made itself, with no request from her agent → the evidence supports the **buyer**. One standard for both sides, whoever runs it ([neutrality principles](docs/decisions/0004-neutrality.md)).

## How it works

```
Maya's assistant ──asks──▶ agent runtime ──signs (ES256)──▶ checkout gate ──charges──▶ PayPal
 (any MCP client)          holds the agent key              verifies, decides         (system of record)
                           no PayPal credentials            stores nothing
                                                                                         │
                       investigator view & re-verify in the browser ◀──reads─────────────┘
```

1. **Consent on PayPal.** Maya approves terms on PayPal's own approval page: merchant, item, cap, cadence, dates and her agent's key fingerprint. They're stored in the PayPal payment token's `description`, which can't be edited afterwards.
2. **Signed requests.** Each purchase is a closed mandate (compact JWS, ES256 over P-256) signed by the agent runtime, which refuses anything outside the terms *before* signing.
3. **A deterministic gate.** The merchant's gate verifies the signature, re-reads the terms from PayPal, checks every limit, and charges the saved wallet with an `invoice_id` that names the period, so PayPal itself refuses a second charge in the same period.
4. **Eleven checks.** For a dispute, Readback rebuilds the case from PayPal's records (dispute → capture → order → PayPal's own record of which saved wallet paid → terms) and runs eleven checks. It suggests an outcome only when the evidence supports one.

Diagrams and where each rule lives: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Principles:** LLMs propose; cryptography and deterministic checks decide. Readback stores nothing; PayPal is the only system of record.

## Status (Oct 15)

| Piece | State |
|---|---|
| `packages/readback-core`: terms grammar, ES256 mandates with header hygiene, fingerprints, labels, gate decision, eleven checks, classification, AP2 import | Built; 143 tests, ~98% coverage, 10,000-mutation tamper fuzz, runs in headless Chromium |
| `apps/agent`: MCP agent runtime (stateless, two secret paths) | Built; tested over the MCP protocol |
| `apps/web`: shopper flow, judge mode, investigator queue + case view, checkout gate, agreements, webhooks | Built; tested against an in-memory PayPal fake and end to end in Chromium |
| `evals/`: 58 labeled scenarios, also runnable in your browser at `/judge` | 58/58 as labeled; dispute suggestions 5/5 seller-side, 6/6 buyer-side, 4/4 no suggestion; 0 wrong in either direction ([results](evals/results/latest.json)) |
| AP2 v0.2 import: checks AP2's own published mandate chain (disclosures, agent signature, binding, amount, payee, dates) | Built; try it at `/ap2` |
| Neutrality: one standard of evidence for both sides | [ADR 0004](docs/decisions/0004-neutrality.md); evals measure errors in both directions |
| Sandbox spike (does PayPal behave as the design assumes?) | *Pending*: step 9 (crypto) passed; steps 1–8 need sandbox credentials |

## Run it locally

```bash
pnpm install
cp .env.example .env                  # PayPal sandbox app credentials (standard merchant REST app, Vault + Disputes + Transaction Search)
cp apps/agent/.env.example apps/agent/.env
pnpm --filter @readback/agent keygen  # prints AGENT_PRIVATE_KEY once; paste into apps/agent/.env
pnpm run doctor                       # checks the configuration (plain `pnpm doctor` is pnpm's own command)
pnpm dev                              # web on :3000, agent runtime on :3001
```

Without PayPal credentials you can still see: both verdicts on `/` (re-verified in your browser), the labeled fixture cases in `/investigator`, every eval scenario at `/judge`, and AP2's official mandate checked at `/ap2`.

Tests: `pnpm test` · browser: `pnpm test:browser` · evals: `pnpm eval` · end to end: `pnpm --filter @readback/web build && pnpm --filter @readback/web test:e2e`.

## Repository

| Path | What |
|---|---|
| `packages/readback-core` | Pure, browser-safe verification: everything that decides anything |
| `apps/agent` | The agent runtime (holds the agent key; MCP server) |
| `apps/web` | The merchant's Readback deployment (Next.js) |
| `evals/` | Labeled scenarios and results |
| `scripts/` | Sandbox spike, `seed:charge`, `agreement:create`, `doctor` |
| `docs/SPEC.md` | Product spec, demo script, schedule |
| `docs/THREAT-MODEL.md` | Threats T1–T34 and mitigations |
| `docs/WHY-PAYPAL.md` | The sourced case for PayPal |
| `docs/PROPOSAL-agent-terms.md` | The API change we propose to PayPal |
| `docs/decisions/` | Decision records, including the public spike record |

## Limitations

See `docs/WHY-PAYPAL.md` §8. In short: sandbox only; the investigator view is a proposed workflow whose results are re-derivable from PayPal, not independent of the merchant's deployment; judge mode holds a demo key in the browser tab; a key swap at setup is stopped only by the shopper comparing fingerprints (THREAT-MODEL T21).

## License

Apache-2.0.
