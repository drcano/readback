# Devpost submission text (draft)

Ready to paste into Devpost's fields. Following the organizers' guidance (Oct 27): the video shows the core flow, PayPal and AI working. This text covers what the video doesn't, and the testing instructions give judges everything they need to explore alone. The README holds the technical walkthrough and setup.

**Before pasting, fill the placeholders on Devpost only, never in this repo:** `<HOSTED_URL>`, `<VIDEO_URL>`, `<REPO_URL>`, `<JUDGE_BUYER_EMAIL>`, `<JUDGE_BUYER_PASSWORD>`, `<JUDGE_MCP_URL>`. Re-read the numbers against `evals/results/latest.json` and `pnpm test` on submission day.

---

## Tagline

The safe way to let your AI shop with PayPal. Every purchase your agent makes, on the record.

## Inspiration

AI agents are starting to spend people's money. Sooner or later a shopper will look at a charge and say: "I didn't buy this. My AI did." Today PayPal reviews that as an ordinary transaction. Nothing in the review records what the shopper actually let her agent buy, so nobody can say whether the agent stayed inside what she allowed.

Pilots solve the same problem with a readback: they repeat every instruction before acting, and the exchange is recorded. Readback does that for AI agents that pay with PayPal.

## What it does

Readback is the dispute layer the agent-payment standards leave out. Google's AP2 and Mastercard's Verifiable Intent both define signed records of what a shopper authorized, and both put dispute resolution out of scope. Readback runs that missing procedure on PayPal today:

1. **She approves her agent's limits on PayPal.** Claude turns one sentence ("one bag of dog food a month, up to $65") into exact terms. Code checks every term, and the terms carry her agent's key fingerprint. She approves them on PayPal's own approval page, and PayPal stores them in the saved-wallet agreement, where nobody can edit them.
2. **Her agent signs every purchase.** Claude can't pay. It can only ask her agent, which signs one exact order (an ES256 signature) and refuses anything outside her terms. The store's gate verifies the signature, re-reads her terms from PayPal, and charges her saved wallet with a per-period invoice number, so PayPal itself refuses a second charge in the same period.
3. **A "my AI bought that" dispute is rebuilt from PayPal's records.** Dispute, then charge, then order, then her approved terms and earlier charges. Readback re-verifies the signature (in the investigator's browser too), runs eleven deterministic checks, and suggests an outcome only when the evidence supports one.

**Same claim, two verdicts.** A purchase her agent signed, inside her terms, gets a recommendation for the seller. A charge the merchant made itself, with no request from her agent, gets a recommendation for the buyer, against the very merchant running Readback. One standard for both sides, which is why it can be believed.

**Readback stores nothing.** There is no database. Every fact on every screen is read from PayPal just now.

### What the video doesn't show

- **Try to break it (`/judge`).** One honest reorder and seven attacks run through the real layers in your browser:
  - a poisoned product page;
  - a forged key;
  - an edited request;
  - a fake sale price;
  - a second bag in the same period;
  - a charge after cancelling;
  - the store charging her wallet directly.

  The honest reorder goes through. Each of the first six attacks is stopped by her agent, the store's gate or PayPal. The store's own charge gets past all three and is caught by the investigator. Every labeled eval scenario can be opened there too.
- **Evaluations.** All 59 labeled scenarios behave as labeled, with 0 wrong suggestions toward either side. In 2,000 random single-field tamperings of an upheld case, none stays upheld; the core test suite runs 10,000 more. There are 415 unit tests and 26 browser checks, and axe-core finds 0 WCAG 2.1 AA violations on 9 pages in light and dark.
- **The standards, checked (`/ap2`, `/vi`).** Readback verifies AP2 v0.2's own published mandate chain and the chain Mastercard Verifiable Intent's example code produces (three signatures, both layer bindings, amount, payee and card). It does this the way a dispute would, in the browser, and is honest about what can't be checked.
- **The finding, and our proposal to PayPal (`/proposal`).** We filed real unauthorized claims in the sandbox, on test agreements. Each time, PayPal deleted the saved-wallet agreement within minutes, erasing the shopper's approved terms right when the dispute needs them. Our proposal asks PayPal to keep the terms with a `deleted_at` time, verify the agent's signature itself, and show the stored terms on its approval page. `/proposal` shows a labeled concept of that page, built from the terms PayPal really stores.
- **One command per case.** `@readback/verify` (in the repo) rebuilds any dispute or charge from PayPal and prints the four lights, without the merchant's web app.
- **For PayPal's Agent Toolkit.** We prepared fixes for two bugs in `accept_dispute_claim` (a note with a space is rejected as an invalid dispute ID, and the merchant's note is sent in the URL), with failing tests first. We also wrote a `provide_dispute_evidence` tool that follows the dispute's own action links.
- **An agent runtime anyone's assistant can use.** The agent is an MCP server that holds the agent's key and no PayPal credentials. Every tool is scoped to one agreement and re-checks the terms on PayPal before acting.

## How we built it

- **PayPal (sandbox):**
  - Vault v3 setup and payment tokens for the agreement, with the terms in the token's `description`;
  - Orders v2 merchant-initiated charges (`vault_id`, `stored_credential`), carrying the signed request, the terms copy, `custom_id` and a per-period `invoice_id`;
  - Payments v2 captures;
  - Disputes (read, provide evidence or supporting info, accept claim);
  - Transaction Search for history;
  - Orders v2 shipment tracking;
  - webhook signature verification.

  Every POST carries a deterministic `PayPal-Request-Id`, so retries are no-ops.
- **AI (Anthropic Claude, through the TypeScript SDK).** Claude works in four places. In each, it proposes and code decides:
  - **Drafting terms:** structured output, then checked against a fixed grammar; anything off is refused, never quietly fixed.
  - **Shopping:** Claude calls the agent's tools. Only what fits her terms gets signed.
  - **Explaining a case:** a plain-English brief where every sentence must cite a check or a PayPal record. Rules validate it, and a rules-only brief replaces it if it fails.
  - **Asking the queue:** Claude picks a filter; the filter itself is deterministic.

  Untrusted content (product pages, dispute messages) reaches Claude only as delimited data. Claude never holds a key and never makes an allow/deny decision.
- **Cryptography:** ES256 (P-256) compact JWS and RFC 7638 key fingerprints with `jose` over WebCrypto. The same verification code runs on the server and in the browser.
- **Stack:**
  - TypeScript (strict) in a pnpm monorepo;
  - Next.js for the shopper, judge and investigator pages;
  - AG Grid for the investigator queue;
  - zod at every boundary;
  - vitest and fast-check for the tests;
  - the MCP TypeScript SDK for the agent runtime.

## Challenges we ran into

- **PayPal doesn't say which saved wallet paid an order.** A vault charge echoes no vault ID, so Readback links a charge to an agreement only through its labels together with PayPal's payer match. Labels can count against the merchant, never for it.
- **The approval page shows a summary the merchant writes, not the terms PayPal stores.** We put the agent's fingerprint in that summary and made it part of what the shopper compares. Fully closing the gap needs PayPal, so it's in the proposal.
- **Real disputes behave differently from the docs.** Some claims skip the inquiry stage, action links appear minutes late, and an unauthorized claim deletes the agreement. Each behavior is recorded with its sandbox response and handled in code.

## Accomplishments that we're proud of

- **The two verdicts run on live PayPal data, re-checked in the judge's own browser.**
- **The project rules against the merchant who runs it** when the evidence says so.
- **A real finding about PayPal's behavior,** with a one-field fix.
- **Nothing is stored.** It still holds up across every edge case we could find, each documented with its proof.

## What we learned

The hard part of agent payments isn't the payment. It's proving later what the person allowed. That proof has to live with the processor, not with the merchant or the agent's vendor.

## What's next for Readback

- PayPal keeping agent terms on the agreement (`agent_terms` with `deleted_at`), verifying the signature at charge time, and showing the stored terms on the approval page.
- Importing AP2 and Verifiable Intent mandates directly as the terms.
- One agreement covering several merchants.

## Built with

`typescript` `next.js` `react` `paypal` `paypal-vault` `paypal-orders` `paypal-disputes` `anthropic` `claude` `mcp` `jose` `webcrypto` `zod` `ag-grid` `vitest` `render`

---

## Testing instructions

**Everything runs against the PayPal sandbox. No real money moves.**

- **Hosted demo:** `<HOSTED_URL>`. It's up through Dec 15, 2026.
- **Video:** `<VIDEO_URL>`.
- **Code:** `<REPO_URL>` (Apache-2.0). The README covers the architecture and running it locally in a few minutes.

### 1. The main result, in two minutes (no sign-in)

1. Open `<HOSTED_URL>`. "Same claim, two verdicts" shows two real charges on the demo shopper's sandbox agreement, read from PayPal just now as if she disputed each one:
   - **Charge A:** her agent signed it, inside her terms, so the recommendation is to uphold the charge.
   - **Charge B:** the store charged her wallet itself, so the recommendation is to refund the buyer.
2. Open either case. Readback rebuilds it record by record from PayPal and re-checks it in your browser ("Re-checked in your browser · matches").
3. Press **"Explain this case in plain English"**. Claude writes the brief, and each sentence cites the check or PayPal record behind it.

### 2. Be the agent yourself (about ten minutes; needs the sandbox buyer below)

In the **Try it yourself** section on the home page, your browser tab becomes the shopper's agent. It holds a temporary key that can't be exported and disappears when you close the tab.

- **Sandbox buyer:** `<JUDGE_BUYER_EMAIL>` / `<JUDGE_BUYER_PASSWORD>` (a PayPal sandbox test account).
- **Allow pop-ups for the site.** If your browser blocks them, the page offers a link instead.

1. **Approve.** Press "Create my key and approve on PayPal". In PayPal's window, sign in with the sandbox buyer and check that the 16-character fingerprint matches the one on the page, then agree.
2. **Buy.**
   - Ask Claude to shop ("the dog food is low"), or press "Sign and buy one bag".
   - Ask a second time: PayPal itself refuses ("Already ordered this period"). That's the design: one purchase per period.
   - "Check this charge" opens your purchase. With no shipment and no history yet, it correctly makes no recommendation.
3. **Be a dishonest merchant.** Press "Charge my wallet without my agent". The store charges your wallet directly, within every limit. Open it: the Agent light is red, and Readback recommends refunding you. "Your two verdicts" puts your two charges side by side.

### 3. Explore the rest

| Page | What to try |
|---|---|
| `/judge` | **"Run all 8 attacks"**, and every labeled evaluation scenario |
| `/investigator` | The dispute queue, live from PayPal plus labeled examples. Ask it a question ("which cases should the store lose?"); rows open with a click or Enter |
| `/shopper` | Type what your agent may buy; Claude drafts the terms, and the readback card shows exactly what would be approved |
| `/ap2`, `/vi` | AP2's and Verifiable Intent's own example mandates, checked in your browser. Change one character and check again |
| `/proposal` | The change we propose to PayPal, as a labeled concept of its approval page |

### 4. Optional: connect an MCP client to the agent runtime

`<JUDGE_MCP_URL>` is a streamable-HTTP MCP server scoped to one demo agreement. It offers `my_agent_card`, `browse_catalog` and `request_reorder`, with no revoke. It works with MCP Inspector or any MCP client. It charges at most once a day, and PayPal refuses the rest.

### Good to know

- **Labels.** Live cases are marked LIVE, and labeled examples say "fixture". The four lights always carry a word or symbol, not only a color.
- **Limits.** Public pages are rate-limited, and the AI features share a daily budget. If it runs out, the page says so and everything else keeps working.
- **One dishonest charge per agreement.** To repeat the judge flow, reload the page and approve a new key.
- **Unauthorized claims delete the agreement.** We didn't file a claim on the demo shopper's agreement: in the sandbox, an unauthorized claim makes PayPal delete it within minutes. That's why its two verdicts are read as if disputed. Real disputes appear in the queue on separate test agreements.
