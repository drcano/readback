// The four lights (Consent · Agent · Terms · Delivery), derived from the checks. One definition,
// reused by Maya's agent card, the queue, and the case view (SPEC §5).
import type { CheckGroup, CheckResult } from "./checks.ts";

export type LightState = "pass" | "caution" | "fail";
export type Light = { group: CheckGroup; state: LightState; summary: string };

export const LIGHT_GROUPS: CheckGroup[] = ["Consent", "Agent", "Terms", "Delivery"];
const PRIORITY = ["3", "1", "2a", "4", "5", "6", "7", "8", "9", "2b", "10", "11"];

// fail: any check in the group failed. caution: all passed, but one relied on merchant-written
// terms or on history that may still be lagging. pass: everything else.
export function lights(checks: CheckResult[]): Light[] {
  return LIGHT_GROUPS.map((group) => {
    const own = checks.filter((c) => c.group === group);
    // Lead with the most telling failure: for Agent that's "no valid signature" (3), not labels (2b).
    const failed = own.filter((c) => !c.pass).sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
    if (failed.length > 0) return { group, state: "fail", summary: failed[0]!.failures[0]!.message };
    if (own.some((c) => c.secondary)) return { group, state: "caution", summary: "Passed using the merchant's copy of the terms." };
    if (own.some((c) => c.provisional)) return { group, state: "caution", summary: "Passed, but history may still be catching up (under 3 hours)." };
    return { group, state: "pass", summary: `All ${own.length} ${group.toLowerCase()} checks passed.` };
  });
}
