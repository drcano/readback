"use client";
// "Ask the agent to shop" (SPEC §5.7): Claude as the shopper's assistant, driving the demo agent
// runtime. The conversation lives only in this component's state and is sent whole on each request.
import { useState } from "react";
import type { ChatMessage, ToolStep } from "@/lib/agent-chat";

const SUGGESTIONS = [
  "Show me my agent card",
  "Biscuit's food is running low. Reorder it.",
  "Buy whatever the store recommends for Biscuit.",
  "Order three bags at once.",
];

type Turn = ChatMessage & { steps?: ToolStep[] };

export function AgentChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    setError(null);
    const messages = next.slice(-12).map(({ role, content: c }) => ({ role, content: c.slice(0, 1000) }));
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as ({ ok: true; reply: string; steps: ToolStep[] } | { ok: false; message: string }) | null;
    setBusy(false);
    if (body?.ok) setTurns([...next, { role: "assistant", content: body.reply, steps: body.steps }]);
    else setError(body?.message ?? "Couldn't reach the demo agent.");
  }

  return (
    <section className="card chat" aria-labelledby="chat-h">
      <div className="chat-head">
        <h2 id="chat-h">Ask the agent to shop</h2>
        <span className="muted small">Claude as her assistant · the agent signs · PayPal charges</span>
      </div>
      <p className="muted small">
        This drives the demo&apos;s shared agent under the demo agreement (1 bag a day, up to $65), not your tab&apos;s key. Try asking it to break
        the rules: the agent won&apos;t sign it and the shop won&apos;t charge it.
      </p>
      <ol className="chat-log" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="chat-turn" data-role={t.role}>
            <span className="cap">{t.role === "user" ? "You" : "Assistant"}</span>
            {t.steps && t.steps.length > 0 && (
              <ul className="chat-steps" aria-label="What the agent did">
                {t.steps.map((s, j) => (
                  <li key={j} className="step" data-state={s.ok ? "pass" : "fail"} title={s.result}>
                    <span className="ic" aria-hidden="true">{s.ok ? "✓" : "✕"}</span>
                    {s.tool}
                    <span className="sr-only">{s.ok ? " succeeded: " : " refused: "}{s.result}</span>
                  </li>
                ))}
              </ul>
            )}
            <p>{t.content}</p>
          </li>
        ))}
        {busy && <li className="chat-turn" data-role="assistant" aria-busy="true"><span className="cap">Assistant</span><p className="muted">Working with the agent…</p></li>}
      </ol>
      {error && <p role="alert" className="banner">{error}</p>}
      {turns.length === 0 && (
        <div className="chat-suggest" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>)}
        </div>
      )}
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <label htmlFor="chat-input" className="sr-only">Message to the shopping assistant</label>
        <input id="chat-input" className="field" value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} placeholder="Ask the assistant…" autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
