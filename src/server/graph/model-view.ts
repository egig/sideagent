import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { forModel, isSummary } from "./summarize.js";

/** Marks the fixed reply the relevance gate writes in place of a model answer. */
const KIND = "sideagent";
const DECLINE = "decline";

export const declineMessage = (text: string) =>
  new AIMessage({ content: text, additional_kwargs: { [KIND]: DECLINE } });

export const isDecline = (m: BaseMessage) => m.getType() === "ai" && m.additional_kwargs?.[KIND] === DECLINE;

/**
 * Drops each declined question and the refusal that answered it. Kept in the thread so the user still sees
 * them, but the model must not: a history of its own refusals teaches it to refuse the next question too.
 */
export function withoutDeclines(messages: BaseMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (isDecline(m)) {
      const prev = out[out.length - 1];
      if (prev && prev.getType() === "human" && !isSummary(prev)) out.pop();
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Answers every tool call that has no result. A turn that was aborted (client left, timeout, step limit)
 * can leave an assistant message whose calls were never answered, and providers reject such a history on every
 * later request. The stored thread is not changed; the model is shown a result saying the call was cut off.
 */
export function answerOpenToolCalls(messages: BaseMessage[]): BaseMessage[] {
  const answered = new Set<string>();
  for (const m of messages) if (m.getType() === "tool") answered.add((m as ToolMessage).tool_call_id);
  const out: BaseMessage[] = [];
  for (const m of messages) {
    out.push(m);
    if (m.getType() !== "ai") continue;
    for (const call of (m as AIMessage).tool_calls ?? []) {
      if (!call.id || answered.has(call.id)) continue;
      out.push(
        new ToolMessage({
          content: "Error: this tool call was interrupted before it finished.",
          tool_call_id: call.id,
          name: call.name,
          status: "error",
        }),
      );
    }
  }
  return out;
}

/** What the model is given for a call: the stored messages, made safe to send. */
export const modelView = (messages: BaseMessage[]) => forModel(answerOpenToolCalls(withoutDeclines(messages)));
