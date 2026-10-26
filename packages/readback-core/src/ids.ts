// The labels Readback puts on every PayPal order (SPEC §4.4), plus deterministic request IDs.
// PayPal doesn't echo which saved agreement paid an order (spike step 3), so the labels name it;
// check 2a only accepts that name if PayPal shows the agreement belongs to the payer charged.
import { z } from "zod";

export const TokenIdSchema = z.string().regex(/^[0-9A-Za-z_-]{1,36}$/);
const HEX16 = "[0-9a-f]{16}";
const TOKEN = "[0-9A-Za-z_-]{1,36}";

const pad3 = (p: number): string => String(p).padStart(3, "0");

// RB-<tokenId>-P003. PayPal refuses a second order with the same invoice_id, which is what
// enforces "one purchase per period" without Readback storing anything.
export function invoiceId(tokenId: string, period: number): string {
  return `RB-${tokenId}-P${pad3(period)}`;
}

export function parseInvoiceId(value: string): { tokenId: string; period: number } | null {
  const m = new RegExp(`^RB-(${TOKEN})-P(\\d{3})$`).exec(value);
  if (!m || m[2] === "000") return null;
  return { tokenId: m[1]!, period: Number(m[2]) };
}

// rb1:<tokenId>:<termsHash16>:p003:<mandateHash16>. Colon-separated because Transaction
// Search's custom_field drops "|".
export function customId(tokenId: string, termsHash: string, period: number, mandateHash: string): string {
  return `rb1:${tokenId}:${termsHash.slice(0, 16)}:p${pad3(period)}:${mandateHash.slice(0, 16)}`;
}

export type CustomId = { tokenId: string; termsHash16: string; period: number; mandateHash16: string };

export function parseCustomId(value: string): CustomId | null {
  const m = new RegExp(`^rb1:(${TOKEN}):(${HEX16}):p(\\d{3}):(${HEX16})$`).exec(value);
  if (!m || m[3] === "000") return null;
  return { tokenId: m[1]!, termsHash16: m[2]!, period: Number(m[3]), mandateHash16: m[4]! };
}

// PayPal-Request-Id values derived from the mandate, so a retry of the same purchase is a no-op
// at PayPal instead of a second charge (CLAUDE.md §5).
// From the mandate's requestHash (its signed content), so a re-encoded signature is the same request.
export function requestIds(requestHash: string) {
  const base = `rb-${requestHash.slice(0, 40)}`;
  return { create: base, capture: `${base}-capture`, track: `${base}-track` };
}

// The agreement a charge's labels name, or null if none does or they disagree. One label is enough:
// the name is only a lead, accepted if PayPal shows the agreement belongs to the payer charged, and
// it can only count for the merchant together with her agent's signature for that same agreement.
// Any RB-<tokenId>-… invoice counts, including the demo's RB-<tokenId>-DIRECT.
export function agreementFromLabels(custom: string | undefined, invoice: string | undefined): string | null {
  const c = custom ? parseCustomId(custom)?.tokenId : undefined;
  const i = invoice ? new RegExp(`^RB-(${TOKEN})-[A-Z0-9]+$`).exec(invoice)?.[1] : undefined;
  if (c && i && c !== i) return null;
  return c ?? i ?? null;
}
