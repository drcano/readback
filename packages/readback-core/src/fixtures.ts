// Builds realistic case bundles, shaped like PayPal's responses, for tests and evals.
// Every variant starts from one valid "hero" case and breaks exactly one thing, so each test
// shows which single fact flips the outcome. Replaced by recorded sandbox JSON once the spike runs.
import type { CaseBundle } from "./case.ts";
import { sha256Hex } from "./hash.ts";
import { customId, invoiceId } from "./ids.ts";
import { buildMandate, type MandatePayload, signMandate } from "./mandate.ts";
import { formatTerms, type Terms } from "./terms.ts";
import { type AgentKey, generateAgentKey } from "./thumbprint.ts";

export const HERO_TOKEN_ID = "8kd73hs9ab";
export const HERO_CAPTURE_TIME = "2026-11-08T15:00:00Z";
const ADDRESS = { address_line_1: "1 Example St", admin_area_2: "Springfield", admin_area_1: "CA", postal_code: "00000", country_code: "US" };

export type HeroCase = {
  bundle: CaseBundle;
  agent: AgentKey;
  terms: Terms;
  termsText: string;
  termsHash: string;
  mandate: MandatePayload;
  jws: string;
  mandateHash: string;
};

export type HeroOptions = {
  agent?: AgentKey; // reuse a key across cases (key generation is the slow part)
  signer?: AgentKey; // sign with a different key than the approved one
  mandate?: Partial<MandatePayload>; // override signed fields (before signing)
  periodDays?: number;
};

// The demo's hero case: a signed, in-terms, tracked charge with two earlier undisputed charges,
// disputed as UNAUTHORISED ("my AI bought that"). Expected: row 13, SELLER_FAVOR.
export async function heroCase(opts: HeroOptions = {}): Promise<HeroCase> {
  const agent = opts.agent ?? (await generateAgentKey(true));
  const terms: Terms = {
    merchant: "Good Boy Provisions",
    sku: "GBP-SR24",
    qty: 1,
    periodDays: opts.periodDays ?? 1, // demo cadence: 1 day = 1 month
    capCents: 6500,
    start: "2026-10-21",
    end: "2027-03-31",
    fingerprint: agent.fingerprint,
  };
  const termsText = formatTerms(terms);
  const termsHash = await sha256Hex(termsText);
  const iat = Date.parse(HERO_CAPTURE_TIME) / 1000 - 10;
  const built = buildMandate({ sku: "GBP-SR24", qty: 1, unitCents: 6499 }, { tokenId: HERO_TOKEN_ID, terms, termsHash }, iat, "jti-hero-0001");
  if (!built.ok) throw new Error(`hero mandate: ${built.error.code}`);
  const mandate = { ...built.value, ...opts.mandate };
  const signer = opts.signer ?? agent;
  const jws = await signMandate(mandate, signer.privateKey, signer.publicJwk);
  const mandateHash = await sha256Hex(jws);
  const cid = customId(HERO_TOKEN_ID, termsHash, mandate.p, mandateHash);
  const inv = invoiceId(HERO_TOKEN_ID, mandate.p);

  const bundle: CaseBundle = {
    dispute: {
      dispute_id: "PP-D-HERO1",
      reason: "UNAUTHORISED",
      status: "UNDER_REVIEW",
      dispute_life_cycle_stage: "CHARGEBACK",
      disputed_transactions: [{ seller_transaction_id: "CAP-HERO", custom: cid, invoice_number: inv }],
    },
    capture: {
      id: "CAP-HERO",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: mandate.amt },
      create_time: HERO_CAPTURE_TIME,
      custom_id: cid,
      invoice_id: inv,
      seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
    },
    order: {
      id: "ORDER-HERO",
      payer: { payer_id: "FAKEPAYER0001" },
      payment_source: {
        paypal: {
          account_id: "FAKEPAYER0001",
          attributes: { vault: { id: HERO_TOKEN_ID } },
          stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT" },
        },
      },
      purchase_units: [
        {
          description: termsText,
          custom_id: cid,
          invoice_id: inv,
          amount: { currency_code: "USD", value: mandate.amt, breakdown: { item_total: { currency_code: "USD", value: mandate.amt } } },
          items: [{ name: "Salmon & Rice Adult (24 lb)", sku: mandate.sku, quantity: String(mandate.qty), unit_amount: { currency_code: "USD", value: mandate.unit }, description: jws }],
          shipping: { address: ADDRESS, trackers: [{ id: "TRK-HERO", status: "SHIPPED" }] },
        },
      ],
    },
    token: {
      id: HERO_TOKEN_ID,
      payment_source: { paypal: { description: termsText, payer_id: "FAKEPAYER0001", shipping: { address: ADDRESS } } },
    },
    tokenDeletedAt: null,
    history: [
      { captureId: "CAP-PRIOR-1", captureTime: "2026-10-21T15:00:00Z", customId: customId(HERO_TOKEN_ID, termsHash, 1, "1".repeat(64)), disputed: false },
      { captureId: "CAP-PRIOR-2", captureTime: "2026-10-28T15:00:00Z", customId: customId(HERO_TOKEN_ID, termsHash, 8, "2".repeat(64)), disputed: false },
      { captureId: "CAP-HERO", captureTime: HERO_CAPTURE_TIME, customId: cid, disputed: true },
    ],
    now: "2026-11-09T15:00:00Z",
  };
  return { bundle, agent, terms, termsText, termsHash, mandate, jws, mandateHash };
}

// "Be a dishonest merchant" (SPEC §5.7): same shopper, same saved wallet, every term respected,
// but the merchant charged it directly. No mandate, no custom_id, a non-canonical invoice.
// Expected: row 3, BUYER_FAVOR, against the merchant running Readback.
export function directCharge(hero: HeroCase): CaseBundle {
  const b = structuredClone(hero.bundle);
  const pu = b.order.purchase_units[0]!;
  delete pu.custom_id;
  pu.invoice_id = `RB-${HERO_TOKEN_ID}-DIRECT`;
  pu.amount = { currency_code: "USD", value: "59.00", breakdown: { item_total: { currency_code: "USD", value: "59.00" } } };
  pu.items = [{ name: "Salmon & Rice Adult (24 lb)", sku: "GBP-SR24", quantity: "1", unit_amount: { currency_code: "USD", value: "59.00" } }];
  delete b.order.payment_source!.paypal!.stored_credential;
  b.capture = { ...b.capture, id: "CAP-DIRECT", amount: { currency_code: "USD", value: "59.00" }, invoice_id: pu.invoice_id };
  delete b.capture.custom_id;
  b.dispute = { ...b.dispute!, dispute_id: "PP-D-TWIST", disputed_transactions: [{ seller_transaction_id: "CAP-DIRECT", invoice_number: pu.invoice_id }] };
  return b;
}
