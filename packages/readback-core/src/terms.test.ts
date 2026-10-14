import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dateToEpochSec,
  endExclusiveSec,
  formatTerms,
  parseTerms,
  periodIndex,
  type Terms,
  TERMS_MAX_LENGTH,
  withinDates,
} from "./terms.ts";
import { sec, STORY_TERMS, STORY_TERMS_STRING } from "./test-helpers.ts";

describe("terms grammar", () => {
  it("parses the story terms (SPEC §4.1 example, 107 chars)", () => {
    expect(STORY_TERMS_STRING).toHaveLength(107);
    expect(parseTerms(STORY_TERMS_STRING)).toEqual({ ok: true, value: STORY_TERMS });
    expect(formatTerms(STORY_TERMS)).toBe(STORY_TERMS_STRING);
  });

  it("the worst case under the limits fits in 127 chars", () => {
    const worst: Terms = {
      merchant: "A".repeat(24),
      sku: "B".repeat(16),
      qty: 999,
      periodDays: 999,
      capCents: 999_999,
      start: "2026-01-01",
      end: "2026-12-31",
      fingerprint: "x".repeat(16),
    };
    const text = formatTerms(worst);
    expect(text.length).toBe(125);
    expect(parseTerms(text).ok).toBe(true);
  });

  const variants: [string, string][] = [
    ["wrong version", STORY_TERMS_STRING.replace("RB1", "RB2")],
    ["lowercase sku", STORY_TERMS_STRING.replace("GBP-SR24", "gbp-sr24")],
    ["qty 0", STORY_TERMS_STRING.replace("x1/", "x0/")],
    ["qty leading zero", STORY_TERMS_STRING.replace("x1/", "x01/")],
    ["period 0", STORY_TERMS_STRING.replace("/30d", "/0d")],
    ["cap without cents", STORY_TERMS_STRING.replace("65.00", "65")],
    ["cap zero", STORY_TERMS_STRING.replace("65.00", "0.00")],
    ["cap too big", STORY_TERMS_STRING.replace("65.00", "10000.00")],
    ["other currency", STORY_TERMS_STRING.replace("USD", "EUR")],
    ["impossible date", STORY_TERMS_STRING.replace("2027-03-31", "2027-02-30")],
    ["end before start", STORY_TERMS_STRING.replace("2027-03-31", "2026-10-13")],
    ["short fingerprint", STORY_TERMS_STRING.replace("qX7mP2vL9cRt4sYb", "qX7mP2vL9cRt4sY")],
    ["grouped fingerprint", STORY_TERMS_STRING.replace("qX7mP2vL9cRt4sYb", "qX7m-P2vL-9cRt-4sYb")],
    ["merchant with pipe", STORY_TERMS_STRING.replace("Good Boy", "Good|Boy")],
    ["merchant double space", STORY_TERMS_STRING.replace("Good Boy", "Good  Boy")],
    ["merchant trailing space", STORY_TERMS_STRING.replace("Provisions |", "Provisions  |")],
    ["merchant too long", STORY_TERMS_STRING.replace("Good Boy Provisions", "Good Boy Provisions Pet Co")],
    ["trailing newline", STORY_TERMS_STRING + "\n"],
    ["extra field", STORY_TERMS_STRING + " | note hi"],
    ["too long", STORY_TERMS_STRING + "x".repeat(TERMS_MAX_LENGTH)],
    ["> 999 periods", STORY_TERMS_STRING.replace("/30d", "/1d").replace("2027-03-31", "2029-07-09")],
  ];
  it.each(variants)("refuses %s", (_label, text) => {
    expect(parseTerms(text).ok).toBe(false);
  });

  it("accepts exactly 999 one-day periods", () => {
    const t = STORY_TERMS_STRING.replace("/30d", "/1d").replace("2027-03-31", "2029-07-08");
    expect(parseTerms(t).ok).toBe(true);
  });

  const arbTerms: fc.Arbitrary<Terms> = fc.record({
    merchant: fc.stringMatching(/^[A-Za-z0-9&'.,-]{1,10}( [A-Za-z0-9&'.,-]{1,6})?$/),
    sku: fc.stringMatching(/^[A-Z0-9-]{1,16}$/),
    qty: fc.integer({ min: 1, max: 999 }),
    periodDays: fc.integer({ min: 30, max: 999 }),
    capCents: fc.integer({ min: 1, max: 999_999 }),
    start: fc.constant("2026-10-14"),
    end: fc.constantFrom("2026-10-14", "2027-03-31", "2028-02-29"),
    fingerprint: fc.stringMatching(/^[A-Za-z0-9_-]{16}$/),
  });

  it("format → parse round-trips for any valid terms (property)", () => {
    fc.assert(fc.property(arbTerms, (t) => {
      const parsed = parseTerms(formatTerms(t));
      return parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(t);
    }));
  });

  it("a one-character mutation is refused unless it is itself canonical terms (property)", () => {
    fc.assert(
      fc.property(fc.nat(STORY_TERMS_STRING.length - 1), fc.integer({ min: 0, max: 0x7f }).map((c) => String.fromCharCode(c)), (i, ch) => {
        const mutated = STORY_TERMS_STRING.slice(0, i) + ch + STORY_TERMS_STRING.slice(i + 1);
        if (mutated === STORY_TERMS_STRING) return true;
        const parsed = parseTerms(mutated);
        return !parsed.ok || formatTerms(parsed.value) === mutated;
      }),
    );
  });
});

describe("dates and periods (UTC)", () => {
  it("rejects impossible dates", () => {
    expect(dateToEpochSec("2026-02-29")).toBeNull();
    expect(dateToEpochSec("2028-02-29")).not.toBeNull();
    expect(dateToEpochSec("2026-13-01")).toBeNull();
    expect(dateToEpochSec("26-01-01")).toBeNull();
  });

  it("start is inclusive from 00:00:00, end inclusive through 23:59:59", () => {
    expect(withinDates(sec("2026-10-13T23:59:59Z"), STORY_TERMS)).toBe(false);
    expect(withinDates(sec("2026-10-14T00:00:00Z"), STORY_TERMS)).toBe(true);
    expect(withinDates(sec("2027-03-31T23:59:59.999Z"), STORY_TERMS)).toBe(true);
    expect(withinDates(sec("2027-04-01T00:00:00Z"), STORY_TERMS)).toBe(false);
    expect(endExclusiveSec(STORY_TERMS)).toBe(sec("2027-04-01T00:00:00Z"));
  });

  it("computes the period index from SPEC §4.2", () => {
    expect(periodIndex(sec("2026-10-13T23:59:59Z"), STORY_TERMS)).toBeNull();
    expect(periodIndex(sec("2026-10-14T00:00:00Z"), STORY_TERMS)).toBe(1);
    expect(periodIndex(sec("2026-11-12T23:59:59Z"), STORY_TERMS)).toBe(1);
    expect(periodIndex(sec("2026-11-13T00:00:00Z"), STORY_TERMS)).toBe(2);
  });

  it("handles the 1-day demo cadence boundary (signed 23:59:58 stays in its period)", () => {
    const daily = { ...STORY_TERMS, periodDays: 1 };
    expect(periodIndex(sec("2026-10-21T23:59:58Z"), daily)).toBe(8);
    expect(periodIndex(sec("2026-10-22T00:00:01Z"), daily)).toBe(9);
  });
});
