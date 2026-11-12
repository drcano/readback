// The four-light strip (Consent · Agent · Terms · Delivery). Every light has a text state and a
// symbol, so color is never the only signal (CLAUDE.md §5 accessibility).
import type { Light } from "@readbackhq/core";

const WORD = { pass: "Pass", caution: "Caution", fail: "Fail" } as const;
const SYMBOL = { pass: "✓", caution: "!", fail: "✕" } as const;

export function FourLights({ lights }: { lights: Light[] }) {
  return (
    <ul className="lights" aria-label="Case summary by group">
      {lights.map((l) => (
        <li key={l.group} className="light" data-state={l.state}>
          <div className="light-head">
            <span>{l.group}</span>
            <span className="state" data-state={l.state}>
              <span aria-hidden="true">{SYMBOL[l.state]} </span>
              {WORD[l.state]}
            </span>
          </div>
          <p>{l.summary}</p>
        </li>
      ))}
    </ul>
  );
}
