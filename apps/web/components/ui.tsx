// Small shared pieces of the investigator UI: the app header, the verdict pill and the compact
// four-light dots. Every state is carried by a word or symbol as well as color (CLAUDE.md §5).
import type { Light } from "@readback/core";
import { verdictLabel } from "@/lib/labels";

export function AppHeader({ section }: { section: string }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <a href="/investigator" className="brand">Readback</a>
        <span className="app-section">{section}</span>
        <nav aria-label="Main" className="app-nav">
          <a href="/investigator">Queue</a>
          <a href="/judge">Judge it yourself</a>
          <a href="/ap2">AP2</a>
        </nav>
        <span className="env-badge">PayPal sandbox</span>
      </div>
    </header>
  );
}

export function VerdictPill({ suggestion, large = false }: { suggestion: "BUYER_FAVOR" | "SELLER_FAVOR" | null; large?: boolean }) {
  return (
    <span className={large ? "pill pill-lg" : "pill"} data-verdict={suggestion ?? "NONE"}>
      {verdictLabel(suggestion)}
    </span>
  );
}

const SYMBOL = { pass: "✓", caution: "!", fail: "✕" } as const;
const WORD = { pass: "passed", caution: "caution", fail: "failed" } as const;

export function LightDots({ lights }: { lights: Light[] }) {
  return (
    <span className="dots" role="img" aria-label={lights.map((l) => `${l.group} ${WORD[l.state]}`).join(", ")}>
      {lights.map((l) => (
        <span key={l.group} className="dot" data-state={l.state} title={`${l.group}: ${l.summary}`}>
          {SYMBOL[l.state]}
        </span>
      ))}
    </span>
  );
}
