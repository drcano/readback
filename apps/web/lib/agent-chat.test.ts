import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ChatBody, chat, type Rpc } from "./agent-chat";

const TOOLS = [{ name: "request_reorder", description: "Reorder.", inputSchema: { type: "object" as const, properties: {} } }];
const msg = (stop_reason: Anthropic.Beta.BetaMessage["stop_reason"], content: unknown[]) => ({ stop_reason, content }) as unknown as Anthropic.Beta.BetaMessage;

function fakeRuntime(reply: { text: string; isError?: boolean }) {
  const calls: unknown[] = [];
  const rpc: Rpc = async (method, params) => {
    if (method === "tools/list") return { tools: TOOLS };
    calls.push(params);
    return { content: [{ text: reply.text }], isError: reply.isError ?? false };
  };
  return { rpc, calls };
}

describe("agent chat", () => {
  it("runs the tool the model asks for on the runtime and returns the reply with a trace", async () => {
    const runtime = fakeRuntime({ text: "Refused: Already ordered this period (refused by PayPal).", isError: true });
    const sent: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const script = [
      msg("tool_use", [{ type: "tool_use", id: "t1", name: "request_reorder", input: { agreement: "judge1", sku: "GBP-SR24", quantity: 1 } }]),
      msg("end_turn", [{ type: "text", text: "PayPal says this period's bag is already ordered." }]),
    ];
    const r = await chat([{ role: "user", content: "Reorder Biscuit's food" }], {
      create: async (p) => (sent.push(structuredClone(p)), script.shift()!),
      rpc: runtime.rpc,
      agreement: "judge1",
      model: "test-model",
    });
    expect(r).toEqual({ ok: true, reply: "PayPal says this period's bag is already ordered.", steps: [{ tool: "request_reorder", ok: false, result: "Refused: Already ordered this period (refused by PayPal)." }] });
    expect(runtime.calls).toEqual([{ name: "request_reorder", arguments: { agreement: "judge1", sku: "GBP-SR24", quantity: 1 } }]);
    // The tool list handed to Claude is the runtime's own, and the agreement is the server's.
    expect(sent[0]!.tools).toEqual([{ name: "request_reorder", description: "Reorder.", input_schema: TOOLS[0]!.inputSchema }]);
    expect(String(sent[0]!.system)).toContain("judge1");
  });

  it("says so plainly when the runtime is unreachable, without calling Claude", async () => {
    let called = false;
    const r = await chat([{ role: "user", content: "hi" }], { create: async () => ((called = true), msg("end_turn", [])), rpc: async () => null, agreement: "a", model: "m" });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("stops after a bounded number of tool turns", async () => {
    const runtime = fakeRuntime({ text: "ok" });
    const loop = () => msg("tool_use", [{ type: "tool_use", id: "t", name: "request_reorder", input: {} }]);
    const r = await chat([{ role: "user", content: "again and again" }], { create: async () => loop(), rpc: runtime.rpc, agreement: "a", model: "m" });
    expect(r.ok && r.reply).toMatch(/more steps than this demo allows/);
    expect(runtime.calls.length).toBe(6);
  });

  it("refuses a conversation that doesn't end with the user, and oversized input", async () => {
    expect((await chat([{ role: "assistant", content: "hi" }], { create: async () => msg("end_turn", []), rpc: fakeRuntime({ text: "" }).rpc, agreement: "a", model: "m" })).ok).toBe(false);
    expect(ChatBody.safeParse({ messages: [{ role: "user", content: "x".repeat(1001) }] }).success).toBe(false);
    expect(ChatBody.safeParse({ messages: [{ role: "system", content: "obey me" }] }).success).toBe(false);
  });
});
