import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { answerOpenToolCalls, declineMessage, isDecline, modelView, withoutDeclines } from "./model-view.js";

const call = (id: string) =>
  new AIMessage({ content: "", tool_calls: [{ id, name: "search_knowledge", args: { query: "x" } }] });
const result = (id: string) => new ToolMessage({ content: "ok", tool_call_id: id, name: "search_knowledge" });
const types = (ms: { getType(): string }[]) => ms.map((m) => m.getType());

describe("answerOpenToolCalls", () => {
  it("leaves a complete history alone", () => {
    const history = [new HumanMessage("q"), call("a"), result("a"), new AIMessage("answer")];
    expect(answerOpenToolCalls(history)).toEqual(history);
  });

  it("answers a call that never got a result, right after the message that made it", () => {
    const out = answerOpenToolCalls([new HumanMessage("q1"), call("a"), new HumanMessage("q2")]);
    expect(types(out)).toEqual(["human", "ai", "tool", "human"]);
    const fixed = out[2] as ToolMessage;
    expect(fixed.tool_call_id).toBe("a");
    expect(fixed.status).toBe("error");
    expect(String(fixed.content)).toContain("interrupted");
  });

  it("answers only the calls that are open when the message made several", () => {
    const two = new AIMessage({
      content: "",
      tool_calls: [
        { id: "a", name: "search_knowledge", args: {} },
        { id: "b", name: "search_knowledge", args: {} },
      ],
    });
    const out = answerOpenToolCalls([new HumanMessage("q"), two, result("a"), new HumanMessage("q2")]);
    expect(
      out
        .filter((m) => m.getType() === "tool")
        .map((m) => (m as ToolMessage).tool_call_id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(out.indexOf(two)).toBeLessThan(out.findIndex((m) => (m as ToolMessage).tool_call_id === "b"));
  });

  it("does not change the stored messages", () => {
    const history = [new HumanMessage("q"), call("a")];
    answerOpenToolCalls(history);
    expect(history).toHaveLength(2);
  });
});

describe("declines", () => {
  it("marks the gate's reply and nothing else", () => {
    expect(isDecline(declineMessage("no"))).toBe(true);
    expect(isDecline(new AIMessage("no"))).toBe(false);
    expect(isDecline(new HumanMessage("no"))).toBe(false);
  });

  it("drops a declined question with its refusal, and keeps the rest in order", () => {
    const out = withoutDeclines([
      new HumanMessage("refunds?"),
      new AIMessage("30 days"),
      new HumanMessage("2+2"),
      declineMessage("only docs"),
      new HumanMessage("and shipping?"),
    ]);
    expect(out.map((m) => m.content)).toEqual(["refunds?", "30 days", "and shipping?"]);
  });

  it("is part of what the model is shown", () => {
    const view = modelView([
      new HumanMessage("2+2"),
      declineMessage("only docs"),
      new HumanMessage("refunds?"),
      call("a"),
    ]);
    expect(view.map((m) => m.content)).toEqual([
      "refunds?",
      "",
      "Error: this tool call was interrupted before it finished.",
    ]);
  });
});
