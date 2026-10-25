// Judge mode: a guided rail through the demo, each step live against the PayPal sandbox (SPEC §5.7).
import { AgentChat } from "@/components/AgentChat";
import { JudgeMode } from "@/components/JudgeMode";
import { TwoVerdicts } from "@/components/TwoVerdicts";
import { AppFooter, AppHeader } from "@/components/ui";

// The real hero and twist disputes, once opened in the sandbox; otherwise the landing uses fixtures.
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
        <TwoVerdicts heroId={caseId(process.env["HERO_DISPUTE_ID"])} twistId={caseId(process.env["TWIST_DISPUTE_ID"])} />
        <AgentChat />
        <JudgeMode />
        <section className="more-links" aria-labelledby="more-h">
          <h2 id="more-h">More to check</h2>
          <ul className="link-cards">
            <li><a className="card link-card" href="/judge"><strong>Judge it yourself</strong><span>Run every labeled scenario and a tamper sample in your browser.</span></a></li>
            <li><a className="card link-card" href="/investigator"><strong>Investigator queue</strong><span>Live sandbox disputes, each rebuilt from PayPal&apos;s records.</span></a></li>
            <li><a className="card link-card" href="/shopper"><strong>Shopper flow</strong><span>Say it once; your agent reads it back as exact terms.</span></a></li>
            <li><a className="card link-card" href="/ap2"><strong>An AP2 mandate, checked</strong><span>AP2&apos;s own published example, verified on PayPal-rails logic.</span></a></li>
          </ul>
        </section>
      </main>
      <AppFooter />
    </>
  );
}
