import type { BaseMessage } from "@langchain/core/messages";
import type { HistoryMessage, HistoryPart } from "../protocol.js";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("");
  }
  return "";
}

/**
 * Rebuilds what the user saw from stored messages. Tool results come from the structured
 * `artifact` (already filtered), never from the wrapped text the model saw.
 */
export function toHistory(messages: BaseMessage[]): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  const assistant = () => {
    let last = out[out.length - 1];
    if (!last || last.role !== "assistant") out.push((last = { role: "assistant", parts: [] }));
    return last;
  };
  for (const m of messages) {
    const type = m._getType();
    if (type === "human") {
      out.push({ role: "user", parts: [{ type: "text", text: textOf(m.content) }] });
    } else if (type === "ai") {
      const a = assistant();
      for (const tc of (m as any).tool_calls ?? []) {
        a.parts.push({ type: "tool", callId: tc.id, operationId: tc.name, args: tc.args });
      }
      const text = textOf(m.content);
      if (text) a.parts.push({ type: "text", text });
    } else if (type === "tool") {
      const id = (m as any).tool_call_id;
      const part = out
        .flatMap((x) => x.parts)
        .find((p): p is Extract<HistoryPart, { type: "tool" }> => p.type === "tool" && p.callId === id);
      if (part) part.result = (m as any).artifact?.result ?? { error: "result unavailable" };
    }
  }
  return out;
}
