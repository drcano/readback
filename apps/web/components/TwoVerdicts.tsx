"use client";
// "Same claim, two verdicts" (SPEC §0): the moment judges should remember. Same shopper, same claim;
// one charge signed by her agent within her terms, one charged by the merchant directly. The real
// sandbox disputes when the deployment names them (HERO_DISPUTE_ID, TWIST_DISPUTE_ID); labeled
// fixtures otherwise, or if PayPal can't be read.
import { checkedIn, type Side, useChecked, VerdictCard } from "./VerdictPair";

const SIDES: [Omit<Side, "id">, Omit<Side, "id">] = [
  { tag: "Charge A", title: "Her agent asked, within her terms", who: "her" },
  { tag: "Charge B", title: "The merchant charged her wallet directly", who: "her" },
];
const FIXTURES = ["fixture-hero", "fixture-twist"];

export function TwoVerdicts({ heroId, twistId }: { heroId?: string | undefined; twistId?: string | undefined }) {
  const ids = heroId && twistId ? [heroId, twistId] : FIXTURES;
  const live = useChecked(ids);
  // A live pair that can't be read falls back to the labeled fixtures rather than showing nothing.
  const failed = ids !== FIXTURES && live.cases.some((c) => c instanceof Error);
  const fallback = useChecked(failed ? FIXTURES : []);
  const { cases, ms } = failed ? fallback : live;
  const shownIds = failed ? FIXTURES : ids;
  const fixture = cases.some((c) => c && !(c instanceof Error) && c.fixture);

  return (
    <section className="card pair verdicts" aria-labelledby="verdicts-h">
      <div className="pair-head">
        <h2 id="verdicts-h">Same claim, two verdicts</h2>
        <span className="muted">Both say: <em>“I didn&apos;t buy this. My AI did.”</em></span>
      </div>
      <div className="pair-grid">
        {SIDES.map((s, i) => <VerdictCard key={s.tag} side={{ ...s, id: shownIds[i]! }} checked={cases[i] ?? null} />)}
      </div>
      <p className="muted small">
        Both cases were just {checkedIn(ms)}: signatures, terms and all eleven checks.{" "}
        {fixture ? "Fixture data, labeled; the live versions run against the PayPal sandbox." : "Live sandbox disputes, read from PayPal just now."} The rules
        are the same for both sides: a signed request inside her approved terms protects the seller; a charge her agent never asked for protects the buyer.
      </p>
    </section>
  );
}
