// The policy gate: the only place that says yes or no to a purchase.
// Deterministic, no model output involved. Fails closed: anything unexpected is a deny.
// It returns the clip it decided, so a caller cannot get an "allow" without a receipt to store.
import { type Clip, nextClip, verifyChain } from "./ledger.ts";
import { type CartMandate, CartMandateSchema, type IntentMandate, IntentMandateSchema, toCents } from "./schemas.ts";
import { verifyCredential } from "./vc.ts";

export type GateRequest = {
  mandateJwt: string; // the shopper-signed IntentMandate VC
  expectedShopper: string; // shopper DID on file for this account
  cart: unknown; // proposed by the agent; untrusted until parsed
  // The *entire* append-only ledger, not a per-mandate view: seq must equal position for
  // verifyChain to pass. Revocations, past spend and replays are all read from here.
  chain: readonly Clip[];
  now: Date;
};

export type GateDecision =
  | { allow: true; clip: Clip; mandate: IntentMandate; cart: CartMandate }
  | { allow: false; clip: Clip };

const DAY_MS = 24 * 60 * 60 * 1000;

// ponytail: months count as 30 days (rolling window); switch to calendar months if a demo needs it.
export function periodMs(period: string): number {
  const match = /^P(\d+)([DWM])$/.exec(period);
  if (!match) throw new Error(`unsupported period ${period}`);
  const days = { D: 1, W: 7, M: 30 }[match[2] as "D" | "W" | "M"];
  return Number(match[1]) * days * DAY_MS;
}

// Pure rule check on already-verified inputs. Returns every violated rule, not just the first,
// so a deny clip explains itself completely.
export function checkRules(mandate: IntentMandate, cart: CartMandate, chain: readonly Clip[], now: Date): string[] {
  const reasons: string[] = [];
  const intent = mandate.shopping_intent;
  const currency = intent.max_amount_per_period.currency;

  if (cart.intent_mandate_id !== mandate.id) reasons.push("CART_FOR_OTHER_MANDATE");
  if (chain.some((c) => c.type === "MANDATE_REVOKED" && c.refs["intent_mandate_id"] === mandate.id)) {
    reasons.push("MANDATE_REVOKED");
  }
  if (now < new Date(mandate.valid_from)) reasons.push("MANDATE_NOT_YET_VALID");
  if (now >= new Date(mandate.expires_at)) reasons.push("MANDATE_EXPIRED");
  if (chain.some((c) => c.type === "GATE_ALLOW" && c.refs["cart_mandate_id"] === cart.id)) {
    reasons.push("CART_ALREADY_AUTHORIZED"); // replay; also the idempotency record for DUPLICATE disputes
  }
  if (!intent.merchants.includes(cart.merchant)) reasons.push("MERCHANT_NOT_ALLOWED");

  for (const item of cart.items) {
    if (!intent.skus.includes(item.sku)) reasons.push(`SKU_NOT_ALLOWED:${item.sku}`);
    if (item.unit_price.currency !== currency) reasons.push(`CURRENCY_MISMATCH:${item.sku}`);
    if (toCents(item.unit_price) > toCents(intent.max_unit_price)) reasons.push(`UNIT_PRICE_OVER_CAP:${item.sku}`);
  }

  const itemsCents = cart.items.reduce((sum, i) => sum + toCents(i.unit_price) * i.qty, 0);
  const qty = cart.items.reduce((sum, i) => sum + i.qty, 0);
  if (cart.total.currency !== currency) reasons.push("CURRENCY_MISMATCH:total");
  if (toCents(cart.total) !== itemsCents) reasons.push("CART_TOTAL_MISMATCH");

  // Past spend = earlier allows for this mandate inside the window. Counting allows (not captures)
  // is deliberately conservative: an allow that never captured still uses up the cap.
  const windowStart = now.getTime() - periodMs(intent.period);
  const priorAllows = chain.filter(
    (c) => c.type === "GATE_ALLOW" && c.refs["intent_mandate_id"] === mandate.id && Date.parse(c.timestamp) > windowStart,
  );
  const spentCents = priorAllows.reduce((sum, c) => sum + Number(c.refs["amount_cents"] ?? NaN), 0);
  const spentQty = priorAllows.reduce((sum, c) => sum + Number(c.refs["quantity"] ?? NaN), 0);
  // NaN (a clip missing its amount) fails both comparisons below, so it must be caught explicitly.
  if (!(spentCents + toCents(cart.total) <= toCents(intent.max_amount_per_period))) reasons.push("PERIOD_AMOUNT_OVER_CAP");
  if (!(spentQty + qty <= intent.max_quantity_per_period)) reasons.push("PERIOD_QUANTITY_OVER_CAP");

  return reasons;
}

// ponytail: the cart is checked but not yet merchant-signed; add CartMandate VC verification in week 2
// once the demo merchant has a DID.
// ponytail: two concurrent calls on the same chain produce clips with the same seq; the store must
// reject the second insert (unique seq) and retry.
export async function authorize(req: GateRequest): Promise<GateDecision> {
  const at = req.now.toISOString();
  const deny = (reasons: string[], refs: Record<string, string> = {}): GateDecision => ({
    allow: false,
    clip: nextClip(req.chain, { type: "GATE_DENY", refs, reasons, timestamp: at }),
  });

  const chainCheck = verifyChain(req.chain);
  if (!chainCheck.ok) return deny([`CHAIN_INVALID:${chainCheck.reason}`]);

  const verified = await verifyCredential(req.mandateJwt, IntentMandateSchema, {
    type: "IntentMandate",
    expectedIssuer: req.expectedShopper,
    now: req.now,
  });
  if (!verified.ok) return deny([`SIGNATURE_INVALID:${verified.reason}`]);
  const mandate = verified.subject;
  if (mandate.issuer !== verified.issuer) return deny(["MANDATE_ISSUER_MISMATCH"], { intent_mandate_id: mandate.id });

  const parsedCart = CartMandateSchema.safeParse(req.cart);
  if (!parsedCart.success) return deny(["CART_MALFORMED"], { intent_mandate_id: mandate.id });
  const cart = parsedCart.data;

  const refs = { intent_mandate_id: mandate.id, cart_mandate_id: cart.id };
  const reasons = checkRules(mandate, cart, req.chain, req.now);
  if (reasons.length > 0) return deny(reasons, refs);

  const quantity = cart.items.reduce((sum, i) => sum + i.qty, 0);
  const clip = nextClip(req.chain, {
    type: "GATE_ALLOW",
    refs: { ...refs, amount_cents: String(toCents(cart.total)), currency: cart.total.currency, quantity: String(quantity) },
    reasons: [],
    timestamp: at,
  });
  return { allow: true, clip, mandate, cart };
}
