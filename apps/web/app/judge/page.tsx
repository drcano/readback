// /judge — "Judge it yourself": every labeled scenario, run live in the visitor's browser.
import { JudgeItYourself } from "@/components/JudgeItYourself";

export default function JudgePage() {
  return (
    <main>
      <p className="label-chip">Evals · runs locally in your browser</p>
      <h1>Judge it yourself</h1>
      <p className="muted">
        53 labeled scenarios (legitimate purchases, attack pages at two layers, gate violations, signature attacks, disputes across the
        classification table, guards) plus 1,000 random tamper attempts, against the same code the product runs.
      </p>
      <JudgeItYourself />
    </main>
  );
}
