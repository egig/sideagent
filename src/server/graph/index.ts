import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemorySaver, type BaseCheckpointSaver, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { createAgent, createMiddleware, tool } from "langchain";
import type { AgentConfig } from "../config.js";
import { SEARCH_TOOL, uniqueSources, type KnowledgeBase } from "../knowledge/index.js";
import { messageText } from "../message-text.js";
import type { Operation } from "../openapi.js";
import { buildSystemPrompt, redact, type AuditEvent } from "../security/policy.js";
import { toolResult, type ToolContext } from "./tools/context.js";
import { runOperation } from "./tools/operation.js";
import { runSearch, SEARCH_TOOL_DEF } from "./tools/search.js";
import { forModel, isSummary, summarize } from "./summarize.js";
import type { PendingApproval, RunContext } from "./types.js";

export type { PendingApproval, RunContext } from "./types.js";

/** The node that calls the model; http/turn.ts streams text only from it. */
export const MODEL_NODE = "model_request";

export interface GraphDeps {
  config: AgentConfig;
  ops: Operation[];
  secret: string;
  checkpointer?: BaseCheckpointSaver;
  onAudit?: (e: AuditEvent) => void | Promise<void>;
  /** Callers must reject an allowlisted operation named SEARCH_TOOL before passing knowledge. */
  knowledge?: KnowledgeBase;
  /** Unbound chat model; the agent binds the tools. */
  model: BaseChatModel;
  /** Extra bindTools options, for models that understand them (OpenAI). */
  bindOptions?: Record<string, unknown>;
}

/** Per-turn fields that http/turn.ts puts under `configurable`. LangGraph types them as Record<string, any>. */
const turnOf = (configurable: unknown) => configurable as { thread_id: string; run: RunContext };

export function buildGraph({
  config,
  ops,
  secret,
  checkpointer,
  onAudit,
  knowledge,
  model,
  bindOptions,
}: GraphDeps): AgentGraph {
  const byName = new Map(ops.map((o) => [o.operationId, o]));
  const defs = ops.map((o) => ({ name: o.operationId, description: o.description, schema: o.inputSchema }));
  if (knowledge) defs.push({ ...SEARCH_TOOL_DEF.function, schema: SEARCH_TOOL_DEF.function.parameters });
  // Declarations only: wrapToolCall below runs every call and never invokes these, so LangChain's own
  // schema check never runs ahead of validateArgs.
  const tools = defs.map((d) =>
    tool(async () => {
      throw new Error("unreachable");
    }, d as any),
  );

  if (!model.bindTools)
    throw new Error("The chat model does not support bindTools(), which sideagent needs for tool calling.");

  const audit = (e: AuditEvent) => {
    try {
      void Promise.resolve(onAudit?.({ ...e, args: redact(e.args) })).catch(() => {});
    } catch {
      /* audit must never break a turn */
    }
  };

  const sideagent = createMiddleware({
    name: "sideagent",

    async wrapModelCall(request, handler) {
      const { configurable, writer, signal } = request.runtime;
      const { run } = turnOf(configurable);
      // A plain-string SystemMessage: `systemPrompt` would become a content-block array.
      const systemMessage = new SystemMessage(
        buildSystemPrompt(config.instructions, run.context, !!knowledge, !!(knowledge && config.scope)),
      );
      const { scope } = config;
      if (knowledge && scope && !(await isGrounded(request.messages, run, knowledge, scope.minScore, { writer }))) {
        // Nothing backs this turn. Without operations the model is not called. With them it may still call one;
        // its text is never shown, because the gate decides the answer. The fixed reply is written to the stream
        // here: a message returned from middleware is not emitted in "messages" mode.
        const offTopic = () => {
          writer?.({ type: "text.delta", text: scope.offTopic });
          return new AIMessage(scope.offTopic);
        };
        if (ops.length === 0) return offTopic();
        // Called directly, not through handler(): the node's call config would drop the nostream tag.
        const quiet = model.bindTools!(tools, bindOptions).withConfig({ tags: ["langsmith:nostream"] });
        const reply = await quiet.invoke([systemMessage, ...forModel(request.messages)], { signal });
        return reply.tool_calls?.length ? reply : offTopic();
      }
      return handler({
        ...request,
        messages: forModel(request.messages),
        systemMessage,
        modelSettings: { ...bindOptions, ...request.modelSettings },
      });
    },

    async wrapToolCall(request) {
      const call = request.toolCall;
      const callId = call.id!;
      // createAgent runs every call of a reply in parallel. Only the first runs: a call that pauses for approval
      // is re-executed on resume, so running several could repeat a mutation.
      const { messages } = request.state;
      let at = messages.length - 1;
      while (at >= 0 && !AIMessage.isInstance(messages[at])) at--;
      if ((messages[at] as AIMessage | undefined)?.tool_calls?.[0]?.id !== callId)
        return new ToolMessage({ tool_call_id: callId, content: "Skipped: call one tool at a time and retry." });

      const { configurable, writer, signal } = request.runtime;
      const { run, thread_id: threadId } = turnOf(configurable);
      const ctx: ToolContext = {
        callId,
        threadId,
        run,
        signal,
        write: (e) => writer?.(e),
        audit,
        base: { at: Date.now(), userId: run.userId, threadId, operationId: call.name, callId },
      };

      const op = byName.get(call.name);
      if (knowledge && call.name === SEARCH_TOOL)
        return runSearch(knowledge, call.args, config.limits.maxResultBytes, ctx, config.scope?.minScore);
      if (op) return runOperation(op, call.args, { config, secret }, ctx);
      audit({ ...ctx.base, args: call.args, status: "denied", approval: "auto", error: "not allowlisted" });
      return toolResult(callId, `Error: unknown tool "${call.name}".`, { error: "not available" });
    },
  });

  // The compiled graph, not the ReactAgent wrapper: the wrapper types getState() as internal (`never`).
  return createAgent({
    model,
    tools,
    // Summarizing runs before each model call, ahead of the prompt and gate in `sideagent`.
    middleware: config.summarize ? [summarize(model, config.summarize), sideagent] : [sideagent],
    checkpointer: checkpointer ?? new MemorySaver(),
  }).graph;
}

/**
 * The relevance gate (config.scope). A turn is backed when an operation was called in it, a search in it
 * found a passage at or above minScore, or the user's message itself matches a passage. The last check
 * runs once per request.
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
    if (m.getType() === "ai" && (m as AIMessage).tool_calls?.some((c) => c.name !== SEARCH_TOOL)) return true;
    if (m.getType() === "tool" && (m as ToolMessage).artifact?.relevant) return true;
  }
  const question = at >= 0 ? messageText(messages[at]!.content).trim().slice(0, 300) : "";
  if (!question) return false;
  run.gate ??= (async () => {
    const hits = await knowledge.search(question);
    if (run.exposeKnowledge) {
      // Shown like a search the model made, so the owner sees what retrieval did even when the gate stops the turn.
      const relevant = hits.filter((h) => h.score >= minScore);
      cfg.writer?.({ type: "tool.start", callId: "gate", operationId: SEARCH_TOOL });
      cfg.writer?.({
        type: "tool.complete",
        callId: "gate",
        operationId: SEARCH_TOOL,
        status: 200,
        args: { query: question },
        result: { sources: uniqueSources(relevant) },
        invalidates: [],
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
    tasks: readonly { interrupts: readonly { value?: unknown }[] }[];
  }>;
  checkpointer?: unknown;
}

/** The approval a thread is paused on, if any. */
export function pendingApprovalOf(snapshot: {
  tasks: readonly { interrupts: readonly { value?: unknown }[] }[];
}): PendingApproval | undefined {
  return snapshot.tasks.flatMap((t) => t.interrupts)[0]?.value as PendingApproval | undefined;
}
