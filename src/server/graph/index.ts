import { AIMessage, SystemMessage, type ToolMessage, type BaseMessage } from "@langchain/core/messages";
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
import { forModel, isSummary, summarize } from "./summarize.js";
import type { RunContext } from "./types.js";

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
      // A plain-string SystemMessage: `systemPrompt` would become a content-block array.
      const systemMessage = new SystemMessage(
        buildSystemPrompt(config.instructions, run.context, !!config.scope, !!config.summarize),
      );
      const { scope } = config;
      if (scope && !(await isGrounded(request.messages, run, knowledge, scope.minScore, { writer }))) {
        // Nothing backs this turn, so the model is not called. The fixed reply is written to the stream
        // here: a message returned from middleware is not emitted in "messages" mode.
        const text = scope.naturalReply
          ? await declineReply(model, lastQuestion(request.messages), scope.offTopic, signal)
          : scope.offTopic;
        writer?.({ type: "text.delta", text });
        return new AIMessage(text);
      }
      return handler({ ...request, messages: forModel(request.messages), systemMessage });
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
  let at = messages.length - 1;
  while (at >= 0 && (messages[at]!.getType() !== "human" || isSummary(messages[at]!))) at--;
  return at >= 0 ? messageText(messages[at]!.content).trim() : "";
}

/**
 * The relevance gate (config.scope). A turn is backed when a search in it found a passage at or above
 * minScore, or the user's message itself matches a passage. The last check runs once per request.
 */
async function isGrounded(
  messages: BaseMessage[],
  run: RunContext,
  knowledge: KnowledgeBase,
  minScore: number,
  cfg: Pick<LangGraphRunnableConfig, "writer">,
): Promise<boolean> {
  let at = messages.length - 1;
  while (at >= 0 && (messages[at]!.getType() !== "human" || isSummary(messages[at]!))) at--;
  const turn = messages.slice(at + 1);
  for (const m of turn) {
    if (m.getType() === "tool" && (m as ToolMessage).artifact?.relevant) return true;
  }
  const question = at >= 0 ? messageText(messages[at]!.content).trim().slice(0, 300) : "";
  if (!question) return false;
  run.gate ??= (async () => {
    const hits = await knowledge.search(question);
    if (run.exposeKnowledge) {
      // Shown like a search the model made, so the owner sees what retrieval did even when the gate stops the turn.
      const relevant = hits.filter((h) => h.score >= minScore);
      cfg.writer?.({ type: "tool.start", callId: "gate", tool: SEARCH_TOOL });
      cfg.writer?.({
        type: "tool.complete",
        callId: "gate",
        tool: SEARCH_TOOL,
        status: 200,
        args: { query: question },
        result: { sources: uniqueSources(relevant) },
      });
      cfg.writer?.({
        type: "knowledge.hits",
        callId: "gate",
        query: question,
        hits: hits.map((h) => ({
          title: h.meta.title,
          ...(h.meta.url ? { url: h.meta.url } : {}),
          score: h.score,
          text: h.text,
        })),
      });
    }
    return hits.some((h) => h.score >= minScore);
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
