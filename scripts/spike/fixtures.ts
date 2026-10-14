// Saves PayPal responses as test fixtures with personal data replaced by fakes (CLAUDE.md §5 Git).
// Dev-time script output, not runtime storage.
import { mkdirSync, writeFileSync } from "node:fs";

const FAKES: Record<string, string> = {
  email_address: "maya@example.com",
  email: "maya@example.com", // Disputes v1 uses `email`, not `email_address`
  given_name: "Maya",
  surname: "Example",
  full_name: "Maya Example",
  address_line_1: "1 Example St",
  address_line_2: "",
  admin_area_2: "Springfield",
  admin_area_1: "CA",
  postal_code: "00000",
  national_number: "5555550100",
};

// Sandbox payer/account IDs are not secret, but we swap them for stable fakes so fixtures
// stay consistent with each other (the same real ID always maps to the same fake).
const idMap = new Map<string, string>();
function fakeId(real: string): string {
  if (!idMap.has(real)) idMap.set(real, `FAKEPAYER${String(idMap.size + 1).padStart(4, "0")}`);
  return idMap.get(real)!;
}

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      if (typeof v === "string" && k in FAKES) return [k, FAKES[k]];
      if (typeof v === "string" && (k === "payer_id" || k === "account_id")) return [k, fakeId(v)];
      // Disputes v1: buyer.name / seller.name are full-name strings. Can't fake every `name`
      // key (items have names too), so only these two parents.
      if ((k === "buyer" || k === "seller") && v !== null && typeof v === "object" && "name" in v) {
        return [k, scrub({ ...v, name: k === "buyer" ? "Maya Example" : "Sandbox Merchant" })];
      }
      return [k, scrub(v)];
    }),
  );
}

export function saveFixture(name: string, data: unknown): void {
  const dir = new URL("../../evals/fixtures/spike/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${name}.json`, dir), JSON.stringify(scrub(data), null, 2) + "\n");
  console.log(`  saved evals/fixtures/spike/${name}.json`);
}
