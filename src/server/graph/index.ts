import { SystemMessage, type ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemorySaver, type BaseCheckpointSaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { RunnableLambda } from "@langchain/core/runnables";
import { createAgent, createMiddleware, tool } from "langchain";
import type { AgentConfig } from "../config.js";
import { SEARCH_TOOL, uniqueSources, type KnowledgeBase } from "../knowledge/index.js";
import { messageText } from "../message-text.js";
import { buildSystemPrompt } from "../security/policy.js";
import { toolResult, type ToolContext } from "./tools/context.js";
import { declineReply } from "./decline.js";
import { runSearch, SEARCH_TOOL_DEF } from "./tools/search.js";
import { declineMessage, modelView, withoutDeclines } from "./model-view.js";
import { isSummary, summarize } from "./summarize.js";
import type { GateVerdict, RunContext } from "./types.js";

export type { RunContext } from "./types.js";

/** Tag on the span of a tool call, so a trace handler can tell it from LangChain's own steps. */
export const TOOL_TAG = "sideagent:tool";

/** The node that calls the model; http/turn.ts streams text only from it. */
export const MODEL_NODE = "model_request";

export interface GraphDeps {
  config: AgentConfig;
  checkpointer?: BaseCheckpointSaver;
  knowledge: KnowledgeBase;
  /** Unbound chat model; the agent binds the search tool. */
  model: BaseChatModel;
}

/** Per-turn fields that http/turn.ts puts under `configurable`. LangGraph types them as Record<string, any>. */
const turnOf = (configurable: unknown) => configurable as { thread_id: string; run: RunContext };

export function buildGraph({ config, checkpointer, knowledge, model }: GraphDeps): AgentGraph {
  // A declaration only: wrapToolCall below runs every call and never invokes this.
  const search = tool(
    async () => {
      throw new Error("unreachable");
    },
    { ...SEARCH_TOOL_DEF.function, schema: SEARCH_TOOL_DEF.function.parameters } as any,
  );

  if (!model.bindTools)
    throw new Error("The chat model does not support bindTools(), which sideagent needs for knowledge search.");

  const sideagent = createMiddleware({
    name: "sideagent",

    async wrapModelCall(request, handler) {
      const { configurable, writer, signal } = request.runtime;
      const { run } = turnOf(configurable);
      const { scope } = config;
      const verdict = scope ? await gateVerdict(request.messages, run, knowledge, scope, { writer }) : "grounded";
      if (verdict === "off") {
        // Nothing in the documentation is close, so the model is not called. The fixed reply is written to the
        // stream here: a message returned from middleware is not emitted in "messages" mode.
        const text = scope!.naturalReply
          ? await declineReply(model, lastQuestion(request.messages), scope!.offTopic, signal)
          : scope!.offTopic;
        writer?.({ type: "text.delta", text });
        return declineMessage(text);
      }
      // A plain-string SystemMessage: `systemPrompt` would become a content-block array.
      const systemMessage = new SystemMessage(
        buildSystemPrompt(config.instructions, run.context, !!scope, !!config.summarize, verdict === "uncertain"),
      );
      return handler({ ...request, messages: modelView(request.messages), systemMessage });
    },

    async wrapToolCall(request) {
      const call = request.toolCall;
      const { configurable, writer, signal } = request.runtime;
      const { run } = turnOf(configurable);
      const ctx: ToolContext = { callId: call.id!, run, signal, write: (e) => writer?.(e) };

      // Tool calls run here, not through LangChain's tool node, so they get their own traced span: callbacks
      // (the `callbacks` option) see them as a child of the step that made the call.
      return RunnableLambda.from(async () =>
        call.name === SEARCH_TOOL
          ? runSearch(knowledge, call.args, config.limits.maxResultBytes, ctx, config.scope?.minScore)
          : toolResult(ctx.callId, `Error: unknown tool "${call.name}".`, { error: "not available" }),
      )
        .withConfig({ runName: call.name, tags: [TOOL_TAG] })
        .invoke(call.args);
    },
  });

  // The compiled graph, not the ReactAgent wrapper: the wrapper types getState() as internal (`never`).
  return createAgent({
    model,
    tools: [search],
    // Summarizing runs before each model call, ahead of the prompt and gate in `sideagent`.
    middleware: config.summarize ? [summarize(model, config.summarize), sideagent] : [sideagent],
    checkpointer: checkpointer ?? new MemorySaver(),
  }).graph;
}

/** The text of the user's last message, summaries excluded. */
function lastQuestion(messages: BaseMessage[]): string {
  const at = lastHuman(messages);
  return at >= 0 ? messageText(messages[at]!.content).trim() : "";
}

/** The user's last message in `messages`, summaries excluded, and where it is. */
function lastHuman(messages: BaseMessage[], before = messages.length): number {
  let at = before - 1;
  while (at >= 0 && (messages[at]!.getType() !== "human" || isSummary(messages[at]!))) at--;
  return at;
}

/**
 * The relevance gate (config.scope). It decides before the model runs, so it must never refuse what the
 * model could still resolve:
 * - grounded: a search in this turn found a passage at or above minScore, or the user's message alone matches
 *   one. The latter runs once per request.
 * - uncertain: the message alone is weaker, but it, or it together with the previous question (a follow-up
 *   such as "and for production?"), reaches clarifyScore. The model gets it, with the scope rules.
 * - off: below clarifyScore. The fixed reply is sent.
 */
async function gateVerdict(
  messages: BaseMessage[],
  run: RunContext,
  knowledge: KnowledgeBase,
  scope: NonNullable<AgentConfig["scope"]>,
  cfg: Pick<LangGraphRunnableConfig, "writer">,
): Promise<GateVerdict> {
  const at = lastHuman(messages);
  for (const m of messages.slice(at + 1)) {
    if (m.getType() === "tool" && (m as ToolMessage).artifact?.relevant) return "grounded";
  }
  const question = at >= 0 ? messageText(messages[at]!.content).trim().slice(0, 300) : "";
  if (!question) return "off";
  run.gate ??= (async () => {
    // Earlier refusals do not count as context: the question they answered was off topic.
    const before = withoutDeclines(messages.slice(0, at));
    const prevAt = lastHuman(before);
    const previous = prevAt >= 0 ? messageText(before[prevAt]!.content).trim().slice(0, 300) : "";
    const clarifyScore = scope.clarifyScore ?? scope.minScore / 2;
    // With clarifyScore at minScore there is no middle band, so the earlier question is not needed.
    const queries = previous && clarifyScore < scope.minScore ? [question, `${previous}\n${question}`] : [question];
    const found = await Promise.all(
      queries.map(async (query) => {
        const hits = await knowledge.search(query);
        return { query, hits, top: Math.max(0, ...hits.map((h) => h.score)) };
      }),
    );
    const alone = found[0]!;
    const best = found.reduce((a, b) => (b.top > a.top ? b : a));
    if (run.exposeKnowledge) {
      // Shown like a search the model made, so the owner sees what retrieval did even when the gate stops the turn.
      const relevant = best.hits.filter((h) => h.score >= scope.minScore);
      cfg.writer?.({ type: "tool.start", callId: "gate", tool: SEARCH_TOOL });
      cfg.writer?.({
        type: "tool.complete",
        callId: "gate",
        tool: SEARCH_TOOL,
        status: 200,
        args: { query: best.query },
        result: { sources: uniqueSources(relevant) },
      });
      cfg.writer?.({
        type: "knowledge.hits",
        callId: "gate",
        query: best.query,
        hits: best.hits.map((h) => ({
          title: h.meta.title,
          ...(h.meta.url ? { url: h.meta.url } : {}),
          score: h.score,
          text: h.text,
        })),
      });
    }
    // Only the message alone can be "grounded": a match that needs the earlier messages is never enough to skip the model's judgement.
    if (alone.top >= scope.minScore) return "grounded";
    if (clarifyScore >= scope.minScore) return "off";
    return best.top >= clarifyScore ? "uncertain" : "off";
  })();
  return run.gate;
}

/**
 * What http/ uses of the compiled graph. createAgent's own state types do not export cleanly from a library
 * (TS2742), so this is declared here instead of inferred.
 */
export interface AgentGraph {
  stream(input: unknown, config: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
  getState(config: { configurable: Record<string, unknown> }): Promise<{
    values: { messages?: BaseMessage[] };
  }>;
  checkpointer?: unknown;
}
