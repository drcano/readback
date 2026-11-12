// The readback card: the plain-language restatement Maya confirms (SPEC §5.1). It is built
// deterministically from validated draft terms, never written by Claude, so it can't say something
// different from what PayPal will store.
import { formatCents } from "@readbackhq/core";
import type { Draft } from "./agreements";
import { CATALOG, MERCHANT_NAME } from "./catalog";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function cadence(periodDays: number): string {
  if (periodDays === 1) return "once a day";
  if (periodDays === 7) return "once a week";
  if (periodDays === 30) return "once a month (every 30 days)";
  return `once every ${periodDays} days`;
}

export function readbackCard(d: Draft): string {
  const item = CATALOG[d.sku]?.name ?? d.sku;
  const [y, m, day] = d.end.split("-");
  const until = `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`;
  return `Your agent may buy up to ${d.qty} × ${item} from ${MERCHANT_NAME}, ${cadence(d.periodDays)}, up to $${formatCents(d.capCents)} per order, until ${until}. Only your agent can ask; PayPal refuses a second order in the same period.`;
}
