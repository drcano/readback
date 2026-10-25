// /investigator — the queue. A proposed workflow for a PayPal claims investigator (SPEC §5.6).
import { QueueGrid } from "@/components/QueueGrid";
import { AppFooter, AppHeader } from "@/components/ui";

export default function QueuePage() {
  return (
    <>
      <AppHeader current="queue" section="Dispute investigator" />
      <main className="console">
        <p className="cap">Proposed workflow for PayPal investigators</p>
        <h1>“My AI bought that.” Who&apos;s right?</h1>
        <p className="lede">Each dispute is rebuilt from PayPal&apos;s own records: what the shopper approved, what her AI agent actually asked for, what was charged, and what shipped. Readback recommends a ruling. A person decides.</p>
        <QueueGrid />
      </main>
      <AppFooter />
    </>
  );
}
