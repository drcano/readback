# @readback/verify

Rebuild an AI-agent purchase case from PayPal's own records and run [Readback](https://github.com/drcano/readback)'s eleven checks.

```bash
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx @readback/verify <disputeId|captureId>
```

It reads the dispute, capture, order, vault payment token and Transaction Search history with the merchant account's API credentials (sandbox by default; set `PAYPAL_API_BASE` to change it), then prints the four lights, each check and the classification. It stores nothing.

As a library:

```ts
import { buildCaseBundle, paypalClient } from "@readback/verify";
import { evaluateCase } from "@readback/core";

const lookup = await buildCaseBundle(disputeId, paypalClient(process.env), new Date());
if (lookup.ok) console.log((await evaluateCase(lookup.bundle)).classification);
```

Apache-2.0.
