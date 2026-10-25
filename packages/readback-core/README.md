# @readback/core

Pure, browser-safe verification for AI agent purchases on PayPal, from [Readback](https://github.com/drcano/readback).

- Terms grammar and `termsHash`; integer-cent money and UTC period math.
- ES256 closed mandates: build, sign, verify and match against terms; RFC 7638 key fingerprints.
- The checkout gate decision (`authorizeCharge`) and the eleven case checks with their classification.

No I/O: functions take PayPal API objects, keys and JWS strings, and return results. The same code runs in Node 22+ and the browser.

```ts
import { evaluateCase } from "@readback/core";

const result = await evaluateCase(bundle); // bundle: dispute, capture, order, payment token, history from PayPal
console.log(result.classification.label, result.classification.suggestion);
```

To build the bundle from a live PayPal account, use [`@readback/verify`](https://www.npmjs.com/package/@readback/verify). Apache-2.0.
