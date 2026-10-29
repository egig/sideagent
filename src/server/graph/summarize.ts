import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { summarizationMiddleware } from "langchain";
import { messageText } from "../message-text.js";
import { wrapSummary } from "../security/policy.js";

const PREFIX = "Summary of the earlier conversation:";
/** What createSummary returns instead of throwing; the history must not be replaced by these. */
const FAILED = ["Error generating summary:", "Previous conversation was too long to summarize.", "No previous"];

/** The message summarizationMiddleware puts in place of the older history. */
export const isSummary = (m: BaseMessage) =>
  m.getType() === "human" && m.additional_kwargs?.lc_source === "summarization";

/**
 * The summary is written by the model from earlier messages, tool output included, and stored as a user message.
 * The model gets it as untrusted data, never as the user's words.
 */
export const forModel = (messages: BaseMessage[]) =>
  messages.map((m) => (isSummary(m) ? new HumanMessage({ content: wrapSummary(summaryText(m)), id: m.id }) : m));

const summaryText = (m: BaseMessage) => {
  const text = messageText(m.content);
  return text.startsWith(PREFIX) ? text.slice(PREFIX.length).trim() : text;
};

/**
 * LangChain's summarizationMiddleware, except that a failed summary leaves the history as it was: the stock
 * middleware still drops every older message and stores the error text as the summary.
 */
export function summarize(model: BaseChatModel, opts: { afterTokens: number; keepMessages: number }) {
  const inner = summarizationMiddleware({
    model,
    trigger: { tokens: opts.afterTokens },
    keep: { messages: opts.keepMessages },
    summaryPrefix: PREFIX,
  });
  const hook = inner.beforeModel;
  const run = typeof hook === "function" ? hook : hook!.hook;
  return {
    ...inner,
    beforeModel: async (...args: Parameters<typeof run>) => {
      const out = (await run(...args)) as { messages?: BaseMessage[] } | undefined;
      const summary = out?.messages?.find(isSummary);
      if (summary && FAILED.some((f) => summaryText(summary).startsWith(f))) return undefined;
      return out;
    },
  } as typeof inner;
}
