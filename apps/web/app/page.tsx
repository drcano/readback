// Judge mode: a guided rail through the demo, each step live against the PayPal sandbox (SPEC §5.7).
import { JudgeMode } from "@/components/JudgeMode";
import { TwoVerdicts } from "@/components/TwoVerdicts";
import { AppFooter, AppHeader } from "@/components/ui";

// Read per request, not at build time: setting HERO_CASE_ID/TWIST_CASE_ID on a running
// deployment must take effect without a rebuild (edge case, Oct 26).
export const dynamic = "force-dynamic";

// Two real charges on Maya's agreement (or dispute IDs), read as if disputed; otherwise the landing uses fixtures.
const caseId = (v: string | undefined) => (v && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : undefined);

export default function Home() {
  return (
    <>
      <AppHeader current="demo" section="Agentic commerce on PayPal" />
      <main className="console">
        <p className="cap">PayPal sandbox demo</p>
        <h1>The safe way to let your AI shop with PayPal</h1>
        {/* The problem, as PayPal describes it (docs/WHY-PAYPAL.md, source S1). */}
        <p className="lede">
          When a shopper says “my AI bought that,” PayPal reviews the transaction itself. Nothing in that review records what she actually
          let her agent buy. Readback puts that record on PayPal&apos;s own rails: she approves her agent&apos;s limits once on PayPal, her agent
          signs every purchase, and a dispute is checked against both.
        </p>
        <TwoVerdicts heroId={caseId(process.env["HERO_CASE_ID"])} twistId={caseId(process.env["TWIST_CASE_ID"])} />
        <JudgeMode />
        <section className="more-links" aria-labelledby="more-h">
          <h2 id="more-h">More to check</h2>
          <ul className="link-cards">
            <li><a className="card link-card" href="/judge"><strong>Try to break it</strong><span>Eight attacks through the real layers, in your browser, and every labeled scenario.</span></a></li>
            <li><a className="card link-card" href="/investigator"><strong>Investigator queue</strong><span>Live sandbox disputes, each rebuilt from PayPal&apos;s records.</span></a></li>
            <li><a className="card link-card" href="/shopper"><strong>Shopper flow</strong><span>Say it once; your agent reads it back as exact terms.</span></a></li>
            <li><a className="card link-card" href="/ap2"><strong>An AP2 mandate, checked</strong><span>AP2&apos;s own published example, verified on PayPal-rails logic.</span></a></li>
            <li><a className="card link-card" href="/vi"><strong>A Verifiable Intent chain, checked</strong><span>Verifiable Intent&apos;s own example chain: three signatures, checked the way a dispute would.</span></a></li>
            <li><a className="card link-card" href="/proposal"><strong>What we&apos;d ask PayPal</strong><span>A concept of PayPal&apos;s approval page, showing the terms PayPal actually stores.</span></a></li>
          </ul>
        </section>
      </main>
      <AppFooter />
    </>
  );
}
