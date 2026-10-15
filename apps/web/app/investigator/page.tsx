// /investigator — the queue. A proposed workflow for a PayPal claims investigator (SPEC §5.6).
import { QueueGrid } from "@/components/QueueGrid";
import { AppHeader } from "@/components/ui";

export default function QueuePage() {
  return (
    <>
      <AppHeader section="Investigator" />
      <main className="wide">
        <div className="page-head">
          <div>
            <p className="eyebrow">Proposed investigator workflow</p>
            <h1>Agent-purchase disputes</h1>
            <p className="muted">Every row is checked against PayPal&apos;s own records: the terms the shopper approved, her agent&apos;s signature, the charge, delivery and history. Results are re-derivable from PayPal, not independent.</p>
          </div>
        </div>
        <QueueGrid />
      </main>
    </>
  );
}
