import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type { AgentConfig } from "../config.js";
import { SEARCH_TOOL, uniqueSources, type KnowledgeBase } from "../knowledge/index.js";
import { messageText } from "../message-text.js";
import type { Operation } from "../openapi.js";
import { buildSystemPrompt, redact, type AuditEvent } from "../security/policy.js";
import { toolResult, type ToolContext } from "./tools/context.js";
import { runOperation } from "./tools/operation.js";
import { runSearch, SEARCH_TOOL_DEF } from "./tools/search.js";
import type { PendingApproval, RunContext } from "./types.js";

export type { PendingApproval, RunContext } from "./types.js";

export interface GraphDeps {
  config: AgentConfig;
  ops: Operation[];
  secret: string;
  checkpointer?: BaseCheckpointSaver;
  onAudit?: (e: AuditEvent) => void | Promise<void>;
  /** Callers must reject an allowlisted operation named SEARCH_TOOL before passing knowledge. */
  knowledge?: KnowledgeBase;
  /** Unbound chat model; the graph binds the tools. */
  model: BaseChatModel;
  /** Extra bindTools options, for models that understand them (OpenAI). */
  bindOptions?: Record<string, unknown>;
}

/** Per-turn fields that http/turn.ts puts under `configurable`. LangGraph types them as Record<string, any>. */
const turnOf = (cfg: LangGraphRunnableConfig) => cfg.configurable as { thread_id: string; run: RunContext };

export function buildGraph({
  config,
  ops,
  secret,
  checkpointer,
  onAudit,
  knowledge,
  model: baseModel,
  bindOptions,
}: GraphDeps) {
  const byName = new Map(ops.map((o) => [o.operationId, o]));
  const toolDefs = ops.map((o) => ({
    type: "function" as const,
    function: { name: o.operationId, description: o.description, parameters: o.inputSchema },
  }));
  if (knowledge) toolDefs.push(SEARCH_TOOL_DEF);

  if (!baseModel.bindTools)
    throw new Error("The chat model does not support bindTools(), which sideagent needs for tool calling.");
  const model = baseModel.bindTools(toolDefs, bindOptions);

  const audit = (e: AuditEvent) => {
    try {
      void Promise.resolve(onAudit?.({ ...e, args: redact(e.args) })).catch(() => {});
    } catch {
      /* audit must never break a turn */
    }
  };

  async function agentNode(state: typeof MessagesAnnotation.State, cfg: LangGraphRunnableConfig) {
    const { run } = turnOf(cfg);
    const system = new SystemMessage(
      buildSystemPrompt(config.instructions, run.context, !!knowledge, !!(knowledge && config.scope)),
    );
    const { scope } = config;
    if (knowledge && scope && !(await isGrounded(state.messages, run, knowledge, minScoreOf(scope), cfg))) {
      // Nothing backs this turn. Without operations the model is not called. With them it may still call one;
      // its text is never shown, because the gate decides the answer.
      if (ops.length === 0) return { messages: [new AIMessage(scope.offTopic)] };
      const quiet = model.withConfig({ tags: ["langsmith:nostream"] });
      const reply = await quiet.invoke([system, ...state.messages], { signal: cfg.signal });
      return { messages: [reply.tool_calls?.length ? reply : new AIMessage(scope.offTopic)] };
    }
    const reply = await model.invoke([system, ...state.messages], { signal: cfg.signal });
    return { messages: [reply] };
  }

  async function toolsNode(state: typeof MessagesAnnotation.State, cfg: LangGraphRunnableConfig) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = last.tool_calls ?? [];

    // Only the first call runs: a node that pauses for approval is re-executed on resume,
    // so running several calls here could repeat a mutation.
    const skipped = calls
      .slice(1)
      .map((c) => new ToolMessage({ tool_call_id: c.id!, content: "Skipped: call one tool at a time and retry." }));
    const call = calls[0];
    if (!call) return { messages: skipped };

    const { run, thread_id: threadId } = turnOf(cfg);
    const callId = call.id!;
    const ctx: ToolContext = {
      callId,
      threadId,
      run,
      signal: cfg.signal,
      write: (e) => cfg.writer?.(e),
      audit,
      base: { at: Date.now(), userId: run.userId, threadId, operationId: call.name, callId },
    };

    let result: ToolMessage;
    const op = byName.get(call.name);
    if (knowledge && call.name === SEARCH_TOOL) {
      result = await runSearch(knowledge, call.args, config.limits.maxResultBytes, ctx, config.scope?.minScore);
    } else if (op) {
      result = await runOperation(op, call.args, { config, secret }, ctx);
    } else {
      audit({ ...ctx.base, args: call.args, status: "denied", approval: "auto", error: "not allowlisted" });
      result = toolResult(callId, `Error: unknown tool "${call.name}".`, { error: "not available" });
    }
    return { messages: [result, ...skipped] };
  }

  const route = (state: typeof MessagesAnnotation.State) => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    return last.tool_calls?.length ? "tools" : END;
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", route, ["tools", END])
    .addEdge("tools", "agent")
    .compile({ checkpointer: checkpointer ?? new MemorySaver() });
}

const minScoreOf = (scope: NonNullable<AgentConfig["scope"]>) => scope.minScore;

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
  cfg: LangGraphRunnableConfig,
): Promise<boolean> {
  let at = messages.length - 1;
  while (at >= 0 && messages[at]!.getType() !== "human") at--;
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

export type AgentGraph = ReturnType<typeof buildGraph>;

/** The approval a thread is paused on, if any. */
export function pendingApprovalOf(snapshot: {
  tasks: readonly { interrupts: readonly { value?: unknown }[] }[];
}): PendingApproval | undefined {
  return snapshot.tasks.flatMap((t) => t.interrupts)[0]?.value as PendingApproval | undefined;
}
