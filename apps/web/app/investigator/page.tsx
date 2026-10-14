// /investigator — the queue. A proposed workflow for a PayPal claims investigator (SPEC §5.6).
import { QueueGrid } from "@/components/QueueGrid";

export default function QueuePage() {
  return (
    <main className="wide">
      <p className="label-chip">Proposed investigator workflow · results are re-derivable from PayPal, not independent</p>
      <h1>Agent-purchase disputes</h1>
      <p className="muted">Each row is evaluated from PayPal's own records: the approved terms, the agent's signature, the charge, delivery and history.</p>
      <QueueGrid />
    </main>
  );
}
