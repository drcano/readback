# Video script: "Same claim, two verdicts" (draft)

Status: **draft, Oct 25.** Built from SPEC §11. The story is Dante's; this only turns it into lines and shots. Lock by **Nov 4**, record **Nov 8–9**, under 3:00.

Voiceover is about 255 words, roughly 1:45 at a calm 150 words a minute. That leaves about a minute of shots with no voice (the lights turning green, PayPal's refusal, the red light), which is where the demo should speak for itself. Every shot below names the real screen or command it comes from. Nothing is mocked.

On screen throughout: a role chip (Shopper / Agent / PayPal / Investigator), captions burned in, every PayPal object ID captioned, and "demo cadence: 1 day = 1 month" wherever a date shows.

---

## 0:00–0:10 · Cold open · chip: PayPal

**Shot:** a dispute notification card, typed out: *"$64.99. 'I didn't buy this. My AI did.'"*

**VO:** Every AI shopping agent is going to hear this. Today, PayPal reviews the transaction. Nobody can check what the agent was actually allowed to do.

## 0:10–0:32 · Delegate · chip: Shopper

**Shot:** `/shopper`. Maya types the story mandate. The readback card fills in: one bag a month, up to $65, until March 31, by her agent only. Her agent shows its fingerprint `GAX4 1xq- rZuP w9cM` in its own agent card (the shopper page never shows it, by design: THREAT-MODEL T21). Cut to PayPal's sandbox approval page showing the same sixteen characters. She clicks Agree.

**VO:** Maya says it once. Her agent reads it back as exact terms, with its own key fingerprint, and PayPal shows her the same fingerprint before she approves. Those terms now live inside PayPal. Nobody can edit them, not the store, and not us.

## 0:32–0:55 · Buy · chip: Agent

**Shot:** judge mode's **"Ask Claude to shop"** (no third-party assistant UI; the tab is the agent): "Biscuit's low." The `request_reorder` tool runs. Cut to the order in the PayPal sandbox: the signed request in the item, the terms copy, `invoice_id RB-…-P0NN`. Then her own PayPal receipt (Activity → the payment): under the item, the long signature string, captioned **"Her agent's signature, on PayPal's own receipt."** (It shows raw because the item description is the only order field that holds it; the proposal asks PayPal to render it as "Signed by your agent GAX4 1xq- rZuP w9cM".) Ask again: *"Already ordered this period (refused by PayPal)."* Four-second flash: the injected "premium bundle" page, refused. Then `my_agent_card`: dates, amounts, receipts.

**VO:** When she asks, her agent signs one exact order, and the store charges it under her agreement. Ask twice, and PayPal itself says no. A poisoned product page can't talk it into more, because the agent won't sign it and the store won't charge it.

## 0:55–1:55 · Investigator · chip: Investigator

**Shot:** home page, "Same claim, two verdicts", then "Open the case" on Charge A: her signed charge on her real sandbox agreement, read as if she disputed it ("If she disputed this charge…"). The live rebuild: the dispute-free case pulls each PayPal record as it arrives (charge, order with the signed request, her approved terms, earlier charges). Consent, Agent, Terms and Delivery go green, each captioned with the PayPal object behind it. "Re-checked in your browser · matches." Recommendation: uphold the charge.

**VO:** When she says "I didn't buy this," Readback rebuilds the charge from PayPal's own records: her approval, her agent's signature, the limits, the shipment. It checks all of it again, right here in the browser. Her agent asked for this exact order, inside the limits she approved. The charge stands.

## 1:55–2:25 · The twist · chip: Investigator

**Shot:** Charge B, same agreement: the store's own charge, $59, every limit respected. Agent: **red**. "Her agent did not ask for this order." Recommendation: refund the buyer. Cut: judge mode, "Be a dishonest merchant", then **"Your two verdicts"**: the judge's own two charges side by side, the same red light on their own key. Then, four seconds: a real unauthorized claim on a test agreement, `PP-R-YOK-10194719`, and the caption **"PayPal deleted her agreement 3 minutes after the claim. We're asking PayPal to keep it."** Cut to `/proposal`.

**VO:** Same claim. Same shopper. Every limit respected. But her agent never asked: the store charged her wallet on its own. So Readback says refund her, against the very merchant running it. That's why it can be believed. And when we filed the real claim, PayPal deleted her agreement within minutes, erasing the record that settles it. That's the one change we're asking PayPal for.

> **Why preview (spike step 7, Oct 26–27):** an unauthorized claim makes PayPal delete the agreement within minutes, so a claim on Maya's agreement would leave only the merchant's copy of her terms, and Readback won't rule for the merchant on that. The two verdicts are read as if disputed, on her live agreement; real disputes are shown on test agreements. The inquiry beat is cut: unauthorized claims skip inquiry.

## 2:25–2:50 · Proof · chip: none

**Shot:** **"Try to break it"**: "Run all 8 attacks" fills the grid, the red "Stopped here" cells stepping across runtime, gate and PayPal, with only the store's direct charge reaching the investigator (about 10 seconds). Then the scoreboard. Terminal: `npx @readback/verify <disputeId>` printing the four lights (needs the npm packages published before recording). The Agent Toolkit change. A caption: "Readback stores nothing."

**VO:** It's all checkable. Fifty-nine labeled scenarios, two thousand tampered requests, none accepted. One command re-runs any case from PayPal. And Readback stores nothing. Every fact is PayPal's.

## 2:50–3:00 · Close

**Shot:** logo card.

**VO:** Readback. The safe way to let your AI shop with PayPal.

---

## Before recording

| Needs | Status (Oct 27) |
|---|---|
| Hosted site on Render | Blocked: GitHub account suspended, so Render has no repo |
| Hero pair | Done Oct 27, in preview: her signed charge (`HERO_CASE_ID`, use the latest seed charge) and the twist `8T065472KN058961S` (`TWIST_CASE_ID`). Never file a claim on Maya's agreement |
| A real dispute to show | `PP-R-YOK-10194719` (test agreement, unauthorized, agreement deleted) and the refund case `PP-R-CFY-10194687` |
| AG Studio queue | Trial starts Nov 1; until then it's AG Grid Community |
| Agent Toolkit change | Prepared locally; it can be called a PR only once it's actually opened |
| Eval numbers | 59/59 scenarios and a 2,000-mutation tamper sample with 0 kept (`evals/results/latest.json`); re-read them on recording day |
| Assistant interface on screen | The Official Rules bar third-party trademarks without permission. Show the agent through the judge-mode chat panel or MCP Inspector, not a branded assistant app, unless permission is in hand |
| Three cold viewers | Each must restate the problem and the twist in one sentence |
