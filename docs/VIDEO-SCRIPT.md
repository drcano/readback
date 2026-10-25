# Video script: "Same claim, two verdicts" (draft)

Status: **draft, Oct 25.** Built from SPEC §11. The story is Dante's; this only turns it into lines and shots. Lock by **Nov 4**, record **Nov 8–9**, under 3:00.

Voiceover is about 255 words, roughly 1:45 at a calm 150 words a minute. That leaves about a minute of shots with no voice (the lights turning green, PayPal's refusal, the red light), which is where the demo should speak for itself. Every shot below names the real screen or command it comes from. Nothing is mocked.

On screen throughout: a role chip (Shopper / Agent / PayPal / Investigator), captions burned in, every PayPal object ID captioned, and "demo cadence: 1 day = 1 month" wherever a date shows.

---

## 0:00–0:10 · Cold open · chip: PayPal

**Shot:** a dispute notification card, typed out: *"$64.99. 'I didn't buy this. My AI did.'"*

**VO:** Every AI shopping agent is going to hear this. Today, PayPal reviews the transaction. Nobody can check what the agent was actually allowed to do.

## 0:10–0:32 · Delegate · chip: Shopper

**Shot:** `/shopper`. Maya types the story mandate. The readback card fills in: one bag a month, up to $65, until March 31, by her agent only. Her agent's fingerprint `GAX4 1xq- rZuP w9cM` appears. Cut to PayPal's sandbox approval page showing the same sixteen characters. She clicks Agree.

**VO:** Maya says it once. Her agent reads it back as exact terms, with its own key fingerprint, and PayPal shows her the same fingerprint before she approves. Those terms now live inside PayPal. Nobody can edit them, not the store, and not us.

## 0:32–0:55 · Buy · chip: Agent

**Shot:** the home page's **"Ask the agent to shop"** panel (no third-party assistant UI): "Biscuit's low." The `request_reorder` tool runs. Cut to the order in the PayPal sandbox: the signed request in the item, the terms copy, `invoice_id RB-…-P0NN`. Ask again: *"Already ordered this period (refused by PayPal)."* Four-second flash: the injected "premium bundle" page, refused. Then `my_agent_card`: dates, amounts, receipts.

**VO:** When she asks, her agent signs one exact order, and the store charges it under her agreement. Ask twice, and PayPal itself says no. A poisoned product page can't talk it into more, because the agent won't sign it and the store won't charge it.

## 0:55–1:15 · Inquiry (only if the sandbox allows) · chip: Shopper

**Shot:** the dispute opens; Maya gets her own approval back in plain words, and closes it herself.

**VO:** Most of these should end right here: she sees what she agreed to, in her own words.

> **Reality check (spike step 7):** the one sandbox dispute so far skipped the inquiry stage and went straight to PayPal review. If that holds, cut this beat and give the 20 seconds to the investigator and the twist.

## 1:15–1:55 · Investigator · chip: Investigator

**Shot:** the queue (AG Studio after Nov 1). The hero row: "I didn't make this purchase." One click into the case. Consent, Agent, Terms and Delivery go green one by one, each captioned with the PayPal object behind it. "Re-checked in your browser in 1 ms · matches." Recommendation: uphold the charge. If PayPal has already ruled, its ruling leads the page, and Readback's check shows it agrees.

**VO:** The claim that escalates lands with an investigator. Readback rebuilds it from PayPal's own records: her approval, her agent's signature, the limits, the shipment. It checks all of it again, right here in the browser. Her agent asked for this exact order, inside the limits she approved. The charge stands.

## 1:55–2:25 · The twist · chip: Investigator

**Shot:** the next row. Same shopper, same claim, $59, every limit respected. Agent: **red**. "Her agent did not ask for this order." Recommendation: refund the buyer. Cut: judge mode, "Be a dishonest merchant", then **"Your two verdicts"**: the judge's own two charges side by side, their agent's next to the store's, the same red light on their own key.

**VO:** Same claim. Same shopper. Every limit respected. But her agent never asked: the store charged her wallet on its own. So Readback says refund her, against the very merchant running it. That's why it can be believed.

## 2:25–2:50 · Proof · chip: none

**Shot:** **"Try to break it"**: "Run all 8 attacks" fills the grid, the red "Stopped here" cells stepping across runtime, gate and PayPal, with only the store's direct charge reaching the investigator (about 10 seconds). Then the scoreboard. Terminal: `npx @readback/verify <disputeId>` printing the four lights. The Agent Toolkit change. A caption: "Readback stores nothing."

**VO:** It's all checkable. Fifty-nine labeled scenarios, two thousand tampered requests, none accepted. One command re-runs any case from PayPal. And Readback stores nothing. Every fact is PayPal's.

## 2:50–3:00 · Close

**Shot:** logo card.

**VO:** Readback. The safe way to let your AI shop with PayPal.

---

## Before recording

| Needs | Status (Oct 25) |
|---|---|
| Hosted site on Render | Blocked: GitHub account suspended, so Render has no repo |
| Hero dispute (UNAUTHORISED) on a recent hero capture | To open by hand. The sandbox decided the first dispute alone in about 14 hours, so open it the day before recording, and decide whether to show it open or already ruled |
| Unsigned twist charge on the hero agreement, then its dispute | Use "Be a dishonest merchant" once (one per agreement), close to recording |
| AG Studio queue | Trial starts Nov 1; until then it's AG Grid Community |
| Agent Toolkit change | Prepared locally; it can be called a PR only once it's actually opened |
| Eval numbers | 59/59 scenarios and a 2,000-mutation tamper sample with 0 kept (`evals/results/latest.json`); re-read them on recording day |
| Assistant interface on screen | The Official Rules bar third-party trademarks without permission. Show the agent through the judge-mode chat panel or MCP Inspector, not a branded assistant app, unless permission is in hand |
| Three cold viewers | Each must restate the problem and the twist in one sentence |
