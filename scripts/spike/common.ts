// Shared by spike steps 2-8: PASS/FAIL printing, the browser pause, and the vault-charge order
// body (steps 3, 4, 5 all build it, so it lives in one place).
import { createInterface } from "node:readline/promises";
import { buildCharge } from "./mandate.ts";
import { paypal } from "./paypal.ts";

export function check(label: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}

export function info(label: string): void {
  console.log(`INFO  ${label}`);
}

// Like Python's input(): blocks until Enter. Returns what was typed.
export async function pause(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

export function usage(text: string): never {
  console.error(`Usage: ${text}`);
  process.exit(2);
}

// The one catalog item every spike charge buys (SPEC §2 demo: Good Boy Provisions).
export const ITEM = { name: "Salmon & Rice Adult (24 lb)", sku: "GBP-SR24", unit: "64.99" };

// Fixed fake tracking number: steps 7 and 8 must agree on it. Sandbox doesn't validate it.
export const TRACKING = { carrier: "USPS", number: "9400111202555842761234" };

// Only the Vault v3 payment-token fields the spike reads.
export type PaymentToken = {
  id: string;
  customer?: { id?: string };
  payment_source: {
    paypal?: {
      description?: string;
      usage_pattern?: string;
      usage_type?: string;
      customer_type?: string;
      permit_multiple_payment_tokens?: boolean;
      payer_id?: string;
      shipping?: unknown;
      billing_plan?: unknown;
    };
  };
};

export async function getToken(tokenId: string): Promise<PaymentToken> {
  return (await paypal({ method: "GET", path: `/v3/vault/payment-tokens/${tokenId}` })) as PaymentToken;
}

// Spike-grade parse of the SPEC §4.1 terms string. readback-core has the real zod parser.
// `RB1 <merchant> | <SKU> x<qty>/<days>d | max USD <cap> | <start>..<end> | agent <fp>`
export function parseTerms(terms: string) {
  const m = /^RB1 (.+) \| ([A-Z0-9-]+) x(\d+)\/(\d+)d \| max USD (\d+\.\d{2}) \| (\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}) \| agent ([A-Za-z0-9_-]{16})$/.exec(terms);
  if (!m) throw new Error(`Terms don't match the RB1 format: ${terms}`);
  // The regex has exactly 8 groups, so we tell TypeScript each one is a string (a "tuple" type).
  // Like Python's `merchant, sku, ... = m.groups()`.
  type Eight = [string, string, string, string, string, string, string, string];
  const [merchant, sku, qty, days, cap, start, end, fingerprint] = m.slice(1) as Eight;
  return { merchant, sku, qty: Number(qty), periodDays: Number(days), cap, start, end, fingerprint };
}

// SPEC §4.2: p = floor((iat − start) / (period_days × 86400)) + 1, start at 00:00:00 UTC.
export function periodIndex(start: string, periodDays: number, iatSec = Math.floor(Date.now() / 1000)): number {
  const startSec = Date.parse(`${start}T00:00:00Z`) / 1000;
  return Math.floor((iatSec - startSec) / (periodDays * 86400)) + 1;
}

// Builds the SPEC §5.3 step 6 order: charge the saved wallet with no buyer present.
export async function vaultOrder(token: PaymentToken, period: number) {
  const terms = token.payment_source.paypal?.description;
  if (!terms) throw new Error(`Token ${token.id} has no payment_source.paypal.description`);
  const charge = await buildCharge({ tokenId: token.id, sku: ITEM.sku, qty: 1, unit: ITEM.unit, period, terms });
  const body = {
    intent: "CAPTURE",
    payment_source: {
      paypal: {
        vault_id: token.id,
        // Merchant-declared, shown but never decisive (SPEC §3). usage_pattern copies the token's.
        stored_credential: {
          payment_initiator: "MERCHANT",
          usage: "SUBSEQUENT",
          usage_pattern: token.payment_source.paypal?.usage_pattern ?? "UNSCHEDULED_PREPAID",
        },
      },
    },
    purchase_units: [
      {
        description: charge.terms,
        custom_id: charge.customId,
        invoice_id: charge.invoiceId,
        amount: {
          currency_code: "USD",
          value: charge.amt,
          breakdown: { item_total: { currency_code: "USD", value: charge.amt } },
        },
        items: [
          {
            name: ITEM.name,
            sku: ITEM.sku,
            quantity: "1",
            unit_amount: { currency_code: "USD", value: ITEM.unit },
            description: charge.jws,
          },
        ],
      },
    ],
  };
  return { body, charge };
}

// Only the order fields steps 3-8 read back.
export type Order = {
  id: string;
  status: string;
  payer?: { payer_id?: string };
  payment_source?: {
    paypal?: { attributes?: { vault?: { id?: string; status?: string } }; stored_credential?: unknown };
  };
  purchase_units: {
    description?: string;
    custom_id?: string;
    invoice_id?: string;
    items?: { name: string; sku?: string; quantity: string; description?: string }[];
    shipping?: { trackers?: { id?: string; status?: string; items?: { sku?: string }[] }[] };
    payments?: { captures?: { id: string; status: string; seller_protection?: unknown }[] };
  }[];
};
