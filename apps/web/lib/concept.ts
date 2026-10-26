// The approval-page concept (/proposal, docs/PROPOSAL-agent-terms.md). It reads the terms PayPal
// stores for Maya's agreement live, and the line PayPal's page shows today is built from those same
// terms. It falls back to the labeled hero fixture when the agreement isn't configured, PayPal can't
// be read, or the page's budget is used up.
import { parseTerms, planName, type Terms } from "@readback/core";
import { heroCase } from "@readback/core/fixtures";
import { readAgreement } from "./agreements";
import type { PayPalClient } from "./paypal/client";

export type Concept = { source: "live" | "example"; tokenId: string; stored: string; terms: Terms; today: string };

export async function approvalConcept(paypal: PayPalClient | null, tokenId: string | undefined, now: Date): Promise<Concept> {
  if (paypal && tokenId) {
    const view = await readAgreement(paypal, tokenId, now, false);
    const parsed = view?.terms ? parseTerms(view.terms) : null;
    if (view?.terms && parsed?.ok) return { source: "live", tokenId, stored: view.terms, terms: parsed.value, today: planName(parsed.value) };
  }
  const token = (await heroCase()).bundle.token;
  const stored = token?.payment_source.paypal.description ?? "";
  const parsed = parseTerms(stored);
  if (!token || !parsed.ok) throw new Error("The hero fixture's terms don't parse.");
  return { source: "example", tokenId: token.id, stored, terms: parsed.value, today: planName(parsed.value) };
}
