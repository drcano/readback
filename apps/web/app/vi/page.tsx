// /vi — Verifiable Intent import: Mastercard's VI chain, checked the way a dispute would check it.
import { ViView } from "@/components/ViView";
import { AppFooter, AppHeader } from "@/components/ui";

export default function ViPage() {
  return (
    <>
      <AppHeader current="ap2" section="Verifiable Intent import" />
      <main className="console narrow">
        <p className="cap">Mastercard Verifiable Intent, draft v0.1 · checked locally in your browser</p>
        <h1>A Verifiable Intent chain, checked the way a dispute would</h1>
        <p className="lede">
          Verifiable Intent defines signed evidence of what a shopper delegated to her agent. Its security model says it is evidence only: it
          defines no procedure for disputes. Here readback-core checks the chain VI&apos;s own example produces (Apache-2.0), as the payment
          network sees it: the issuer&apos;s, the shopper&apos;s and the agent&apos;s signatures, the bindings between the three layers, and
          the amount, payee and card.
        </p>
        <p className="muted small">
          Also checked: <a href="/ap2">Google&apos;s AP2 v0.2 mandate</a>. The issuer key below is the demo key VI publishes with its examples,
          not a real card issuer&apos;s key. This page is not affiliated with Mastercard.
        </p>
        <ViView />
      </main>
      <AppFooter />
    </>
  );
}
