"use client";
// "Ask Claude to shop" (SPEC §5.7): Claude is the shopper's assistant; this tab is her agent. When
// Claude asks for an order, the tab pre-checks it against her terms, signs it with its own key and
// submits it to the store's gate; what happened is shown by code, not by Claude. The conversation
// lives only in this component's state and is sent whole on each request.
import type { AgentKey } from "@readbackhq/core";
import { useState } from "react";
import type { ChatMessage, ToolStep } from "@/lib/agent-chat";
import { signAndBuy, type TabResult } from "@/lib/tab-agent";

const SUGGESTIONS = ["Show me my agent card", "Biscuit's food is running low. Reorder it.", "Buy whatever the store recommends for Biscuit.", "Order three bags at once."];
const OUTCOME = { charged: { ok: true, word: "Signed and charged" }, refused: { ok: false, word: "Refused to sign" }, denied: { ok: false, word: "Signed, then refused" } } as const;

type Turn = ChatMessage & { steps?: ToolStep[]; outcome?: TabResult["outcome"] };

export function AgentChat({ agentKey, tokenId, onCharged }: { agentKey: AgentKey | null; tokenId: string | null; onCharged: (captureId: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(agentKey && tokenId);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || !agentKey || !tokenId) return;
    let next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    setBusy("Claude is thinking…");
    setError(null);
    const messages = next.slice(-16).map(({ role, content: c }) => ({ role, content: c.slice(0, 1000) }));
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agreement: tokenId, messages }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as ({ ok: true; reply: string; steps: ToolStep[]; pending?: { sku: string; quantity: number } } | { ok: false; message: string }) | null;
    if (!body?.ok) {
      setBusy(null);
      return setError(body?.message ?? "Couldn't reach the assistant.");
    }
    next = [...next, { role: "assistant", content: body.reply, steps: body.steps }];
    setTurns(next);
    if (body.pending) {
      // Claude asked; the tab decides. Same checks as the agent runtime, then the store's gate.
      setBusy("Your agent (this tab) is checking and signing…");
      const r = await signAndBuy(agentKey, tokenId, body.pending.sku, body.pending.quantity);
      setTurns([...next, { role: "agent", content: r.message, outcome: r.outcome }]);
      if (r.outcome === "charged") onCharged(r.captureId);
    }
    setBusy(null);
  }

  if (!ready) return <p className="muted small chat-locked">Ask Claude to shop opens after step 1, once your tab is the approved agent.</p>;
  return (
    <div className="chat" aria-label="Ask Claude to shop">
      <ol className="chat-log" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="chat-turn" data-role={t.role} data-outcome={t.outcome}>
            <span className="cap">{t.role === "user" ? "You" : t.role === "assistant" ? "Claude" : "Your agent (this tab)"}</span>
            {t.steps && t.steps.length > 0 && (
              <ul className="chat-steps" aria-label="Tools Claude used">
                {t.steps.map((s, j) => (
                  <li key={j} className="step" data-state={s.ok ? "pass" : "fail"} title={s.result}>
                    <span className="ic" aria-hidden="true">{s.ok ? "✓" : "✕"}</span>
                    {s.tool}
                    <span className="sr-only">: {s.result}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.outcome && (
              <span className="step" data-state={OUTCOME[t.outcome].ok ? "pass" : "fail"}>
                <span className="ic" aria-hidden="true">{OUTCOME[t.outcome].ok ? "✓" : "✕"}</span>
                {OUTCOME[t.outcome].word}
              </span>
            )}
            <p>{t.content}</p>
          </li>
        ))}
        {busy && <li className="chat-turn" data-role="assistant" aria-busy="true"><p className="muted">{busy}</p></li>}
      </ol>
      {error && <p role="alert" className="banner">{error}</p>}
      {turns.length === 0 && (
        <div className="chat-suggest" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={Boolean(busy)}>{s}</button>)}
        </div>
      )}
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <label htmlFor="chat-input" className="sr-only">Message to Claude, your shopping assistant</label>
        <input id="chat-input" className="field" value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Claude to shop…" autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}
