import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
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
import { SEARCH_TOOL, type KnowledgeBase } from "../knowledge/index.js";
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
    const system = new SystemMessage(buildSystemPrompt(config.instructions, run.context, !!knowledge));
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
      result = await runSearch(knowledge, call.args, config.limits.maxResultBytes, ctx);
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

export type AgentGraph = ReturnType<typeof buildGraph>;

/** The approval a thread is paused on, if any. */
export function pendingApprovalOf(snapshot: {
  tasks: readonly { interrupts: readonly { value?: unknown }[] }[];
}): PendingApproval | undefined {
  return snapshot.tasks.flatMap((t) => t.interrupts)[0]?.value as PendingApproval | undefined;
}
