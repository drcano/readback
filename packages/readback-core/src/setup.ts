// The Vault v3 setup-token request (SPEC §5.1 step 3, §4.5): the terms go in `description`
// (what PayPal stores, ≤128), and `billing_plan` is sent only so PayPal's approval page shows
// the plan. PayPal doesn't return billing_plan, so nothing ever reads it back.
import { formatCents } from "./money.ts";
import { fail, ok, type Result } from "./result.ts";
import { endExclusiveSec, formatTerms, periodIndex, type Terms } from "./terms.ts";

export type SetupTokenRequest = {
  payment_source: {
    paypal: {
      description: string;
      usage_pattern: "UNSCHEDULED_PREPAID";
      usage_type: "MERCHANT";
      customer_type: "CONSUMER";
      permit_multiple_payment_tokens: true;
      billing_plan: {
        name: string;
        billing_cycles: [
          {
            tenure_type: "REGULAR";
            sequence: 1;
            total_cycles: number;
            // [spike] Vault v3's spec leaves `frequency` empty; this is the Subscriptions v1 shape.
            frequency: { interval_unit: "DAY"; interval_count: number };
            pricing_scheme: { pricing_model: "VARIABLE"; price: { currency_code: "USD"; value: string } };
          },
        ];
        one_time_charges: { total_amount: { currency_code: "USD"; value: "0.00" } };
      };
      experience_context: { brand_name: string; return_url: string; cancel_url: string; shipping_preference: "GET_FROM_FILE" };
    };
  };
};

const PLAN_NAME = /^[A-Za-z0-9 ()+',.:-]{1,127}$/;

// "Good Boy Provisions: GBP-SR24, up to 1 per order every 30 days, max USD 65.00 each, until 2027-03-31"
export function planName(t: Terms): string {
  const every = t.periodDays === 1 ? "every day" : `every ${t.periodDays} days`;
  // Merchant names may contain "&", which PayPal's plan-name charset doesn't allow.
  return `${t.merchant.replaceAll("&", "and")}: ${t.sku}, up to ${t.qty} per order ${every}, max USD ${formatCents(t.capCents)} each, until ${t.end}`;
}

export function buildSetupTokenRequest(
  t: Terms,
  urls: { returnUrl: string; cancelUrl: string },
): Result<SetupTokenRequest> {
  const name = planName(t);
  if (!PLAN_NAME.test(name)) return fail("PLAN_NAME_INVALID", "The plan name doesn't fit PayPal's limits.");
  if (t.periodDays > 365) return fail("PERIOD_TOO_LONG", "PayPal's plan display allows at most 365 days per cycle.");
  return ok({
    payment_source: {
      paypal: {
        description: formatTerms(t),
        usage_pattern: "UNSCHEDULED_PREPAID",
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: true,
        billing_plan: {
          name,
          billing_cycles: [
            {
              tenure_type: "REGULAR",
              sequence: 1,
              total_cycles: periodIndex(endExclusiveSec(t) - 1, t)!,
              frequency: { interval_unit: "DAY", interval_count: t.periodDays },
              pricing_scheme: { pricing_model: "VARIABLE", price: { currency_code: "USD", value: formatCents(t.capCents) } },
            },
          ],
          one_time_charges: { total_amount: { currency_code: "USD", value: "0.00" } },
        },
        experience_context: { brand_name: t.merchant, return_url: urls.returnUrl, cancel_url: urls.cancelUrl, shipping_preference: "GET_FROM_FILE" },
      },
    },
  });
}
