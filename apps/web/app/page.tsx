// Judge mode: a guided rail through the demo, each step live against the PayPal sandbox (SPEC §5.7).
import { JudgeMode } from "@/components/JudgeMode";

export default function Home() {
  return (
    <main>
      <p className="label-chip">Readback · PayPal sandbox demo</p>
      <h1>The safe way to let your AI shop with PayPal</h1>
      <p className="muted">
        Every purchase your agent makes, on the record. Approve terms once on PayPal; your agent signs each purchase; when
        someone says "my AI bought that", the truth takes one click.
      </p>
      <JudgeMode />
      <p className="muted">
        Also: <a href="/shopper">the shopper flow</a> · <a href="/investigator">the investigator queue</a>
      </p>
    </main>
  );
}
