import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { applyEvent, toInitialMessages, type Part } from "./parts.js";

const run = (events: AgentEvent[]) => events.reduce<Part[]>((parts, ev) => applyEvent(parts, ev), []);

describe("applyEvent", () => {
  it("joins consecutive text deltas into one part", () => {
    expect(
      run([
        { type: "text.delta", text: "Hel" },
        { type: "text.delta", text: "lo" },
      ]),
    ).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("starts a new text part after a tool call", () => {
    const parts = run([
      { type: "text.delta", text: "a" },
      { type: "tool.start", callId: "c1", tool: "search_knowledge" },
      { type: "text.delta", text: "b" },
    ]);
    expect(parts.map((p) => p.type)).toEqual(["text", "tool-call", "text"]);
  });

  it("updates one tool part from start to completion, and reports errors as text", () => {
    const parts = run([
      { type: "tool.start", callId: "c1", tool: "search_knowledge" },
      {
        type: "tool.complete",
        callId: "c1",
        tool: "search_knowledge",
        status: 200,
        args: { query: "refunds" },
        result: { sources: [] },
      },
      { type: "error", code: "timeout", message: "turn timed out" },
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "c1",
      toolName: "search_knowledge",
      args: { query: "refunds" },
      result: { sources: [] },
    });
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
      {
        role: "assistant",
        parts: [
          {
            type: "tool",
            callId: "c1",
            tool: "search_knowledge",
            args: { query: "x" },
            result: { sources: [] },
          },
        ],
      },
    ]);
    expect(user!.content).toEqual([{ type: "text", text: "hi" }]);
    expect(assistant!.content[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "c1",
      toolName: "search_knowledge",
      args: { query: "x" },
      result: { sources: [] },
    });
  });
});

describe("knowledge.hits", () => {
  it("folds the passages into the search call's result", () => {
    const parts = run([
      { type: "tool.start", callId: "c1", tool: "search_knowledge" },
      {
        type: "tool.complete",
        callId: "c1",
        tool: "search_knowledge",
        status: 200,
        args: { query: "q" },
        result: { sources: [{ id: "a", title: "A" }] },
      },
      { type: "knowledge.hits", callId: "c1", query: "q", hits: [{ title: "A", score: 0.9, text: "passage" }] },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "tool-call",
      result: { sources: [{ id: "a", title: "A" }], hits: [{ title: "A", score: 0.9, text: "passage" }] },
    });
  });
});
