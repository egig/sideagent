import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { applyEvent, toInitialMessages, type Part } from "./parts.js";

const run = (events: AgentEvent[]) => events.reduce<Part[]>((parts, ev) => applyEvent(parts, ev), []);

describe("applyEvent", () => {
  it("joins consecutive text deltas into one part", () => {
    expect(run([{ type: "text.delta", text: "Hel" }, { type: "text.delta", text: "lo" }])).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("starts a new text part after a tool call", () => {
    const parts = run([
      { type: "text.delta", text: "a" },
      { type: "tool.start", callId: "c1", operationId: "listInvoices" },
      { type: "text.delta", text: "b" },
    ]);
    expect(parts.map((p) => p.type)).toEqual(["text", "tool-call", "text"]);
  });

  it("updates one tool part from request to completion", () => {
    const parts = run([
      { type: "approval.request", callId: "c1", operationId: "createInvoice", method: "POST", path: "/invoices", args: { body: { customer: "x" } }, token: "t", expiresAt: 0 },
      { type: "tool.start", callId: "c1", operationId: "createInvoice" },
      { type: "tool.complete", callId: "c1", operationId: "createInvoice", status: 201, args: { body: { customer: "x" } }, result: { id: 1 }, invalidates: [] },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "tool-call", toolCallId: "c1", toolName: "createInvoice", args: { body: { customer: "x" } }, result: { id: 1 } });
  });

  it("marks rejected calls and reports errors as text", () => {
    const parts = run([
      { type: "tool.rejected", callId: "c1", operationId: "deleteInvoice" },
      { type: "error", code: "timeout", message: "turn timed out" },
    ]);
    expect(parts[0]).toMatchObject({ toolName: "deleteInvoice", result: { rejected: true } });
    expect(parts[1]).toEqual({ type: "text", text: "⚠ turn timed out" });
  });

  it("does not mutate its input", () => {
    const before: Part[] = [{ type: "text", text: "a" }];
    applyEvent(before, { type: "text.delta", text: "b" });
    expect(before).toEqual([{ type: "text", text: "a" }]);
  });
});

describe("toInitialMessages", () => {
  it("maps history tool parts to tool-call parts", () => {
    const [user, assistant] = toInitialMessages([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "tool", callId: "c1", operationId: "listInvoices", args: { limit: 1 }, result: [] }] },
    ]);
    expect(user!.content).toEqual([{ type: "text", text: "hi" }]);
    expect(assistant!.content[0]).toMatchObject({ type: "tool-call", toolCallId: "c1", toolName: "listInvoices", args: { limit: 1 }, result: [] });
  });
});
