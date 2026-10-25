// /judge — "Judge it yourself": every labeled scenario, run live in the visitor's browser.
import { JudgeItYourself } from "@/components/JudgeItYourself";
import { AppFooter, AppHeader } from "@/components/ui";

export default function JudgePage() {
  return (
    <>
      <AppHeader current="judge" section="Evals · run in your browser" />
      <main className="console narrow">
        <p className="cap">Evals · runs locally in your browser</p>
        <h1>Judge it yourself</h1>
        <p className="lede">
          Every labeled scenario (legitimate purchases, attack pages at two layers, gate violations, signature attacks, disputes where the
          evidence supports the seller, the buyer, or neither, and guards) plus 1,000 random tamper attempts, against the same code the product
          runs. Wrong suggestions are counted in both directions.
        </p>
        <JudgeItYourself />
      </main>
      <AppFooter />
    </>
  );
}
