// /ap2 — AP2 import: an AP2 mandate, checked on PayPal-rails logic (SPEC §4.6).
import { Ap2View } from "@/components/Ap2View";
import { AppFooter, AppHeader } from "@/components/ui";

export default function Ap2Page() {
  return (
    <>
      <AppHeader current="ap2" section="AP2 v0.2 import" />
      <main className="console narrow">
        <p className="cap">AP2 v0.2 · checked locally in your browser</p>
        <h1>An AP2 mandate, enforced on rails that exist today</h1>
        <p className="lede">
          AP2 defines signed records of what a user authorized. Readback runs AP2's autonomous model on PayPal's existing rails. Here
          readback-core reads a real AP2 v0.2 payment mandate chain (AP2's own published example, Apache-2.0) and checks it: disclosures,
          the agent's signature, the binding between the two mandates, amount, payee and dates.
        </p>
        <p className="muted small">Also checked: <a href="/vi">Mastercard&apos;s Verifiable Intent chain</a>.</p>
        <Ap2View />
      </main>
      <AppFooter />
    </>
  );
}
