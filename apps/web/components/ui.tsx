// Shared pieces of the investigator UI: header, footer, recommendation pill, evidence steps.
// Every state is carried by a word or symbol as well as color (CLAUDE.md §5).
import type { Light } from "@readback/core";
import { recommendation, stepShort } from "@/lib/labels";

// The same header on every page. `section` names whose view this is (the video's role chip).
const NAV = [
  { id: "demo", href: "/", label: "Try it" },
  { id: "shopper", href: "/shopper", label: "Shopper" },
  { id: "queue", href: "/investigator", label: "Investigator" },
  { id: "judge", href: "/judge", label: "Judge it yourself" },
  { id: "ap2", href: "/ap2", label: "Standards" },
] as const;
type NavId = (typeof NAV)[number]["id"];

export function AppHeader({ current, section }: { current?: NavId; section: string }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <a href="/" className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
          Readback
        </a>
        <span className="app-section">{section}</span>
        <nav aria-label="Main" className="app-nav">
          {NAV.map((n) => <a key={n.id} href={n.href} aria-current={current === n.id ? "page" : undefined}>{n.label}</a>)}
        </nav>
        <span className="env-badge">Live · PayPal sandbox</span>
      </div>
    </header>
  );
}

export function AppFooter() {
  return <footer className="app-footer">Readback is an independent hackathon project built on PayPal&apos;s public APIs. It is not a PayPal product.</footer>;
}

export function RecPill({ suggestion }: { suggestion: "BUYER_FAVOR" | "SELLER_FAVOR" | null }) {
  const r = recommendation(suggestion);
  return <span className="rec" data-rec={r.key}>{r.label}</span>;
}

const SYMBOL = { pass: "✓", caution: "!", fail: "✕" } as const;
const WORD = { pass: "passed", caution: "partly verified", fail: "failed" } as const;

export function Steps({ lights }: { lights: Light[] }) {
  return (
    <ul className="steps" aria-label="Evidence" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {lights.map((l) => (
        <li key={l.group} className="step" data-state={l.state} title={l.summary}>
          <span className="ic" aria-hidden="true">{SYMBOL[l.state]}</span>
          {stepShort(l.group)}
          <span className="sr-only">: {WORD[l.state]}</span>
        </li>
      ))}
    </ul>
  );
}
