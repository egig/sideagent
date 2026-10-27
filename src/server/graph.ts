import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  Command,
  END,
  interrupt,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { AgentConfig } from "./config.js";
import { signApproval } from "./approval.js";
import { executeOperation } from "./executor.js";
import { validateArgs, type Operation } from "./openapi.js";
import { SEARCH_TOOL, uniqueSources, wrapKnowledge, type KnowledgeBase } from "./knowledge.js";
import { buildSystemPrompt, redact, wrapToolResult, type AuditEvent } from "./policy.js";

export interface RunContext {
  userId: string;
  headers: Record<string, string>;
  context?: unknown;
}

export interface GraphDeps {
  config: AgentConfig;
  ops: Operation[];
  secret: string;
  checkpointer?: BaseCheckpointSaver;
  onAudit?: (e: AuditEvent) => void | Promise<void>;
  knowledge?: KnowledgeBase;
  /** Unbound chat model; the graph binds the tools. */
  model: BaseChatModel;
  /** Extra bindTools options, for models that understand them (OpenAI). */
  bindOptions?: Record<string, unknown>;
}

export interface PendingApproval {
  callId: string;
  operationId: string;
  method: string;
  path: string;
  args: unknown;
  token: string;
  expiresAt: number;
}

const APPROVAL_TTL_MS = 10 * 60_000;

export function buildGraph({ config, ops, secret, checkpointer, onAudit, knowledge, model: baseModel, bindOptions }: GraphDeps) {
  const byName = new Map(ops.map((o) => [o.operationId, o]));
  const toolDefs = ops.map((o) => ({
    type: "function" as const,
    function: { name: o.operationId, description: o.description, parameters: o.inputSchema },
  }));

  if (knowledge) {
    if (byName.has(SEARCH_TOOL)) throw new Error(`An allowlisted operation is named "${SEARCH_TOOL}", which is reserved for knowledge search`);
    toolDefs.push({
      type: "function" as const,
      function: {
        name: SEARCH_TOOL,
        description: "Search the application's documentation and knowledge base. Returns relevant passages.",
        parameters: { type: "object", properties: { query: { type: "string", description: "What to look up" } }, required: ["query"], additionalProperties: false },
      },
    });
  }

  if (!baseModel.bindTools) throw new Error("The chat model does not support bindTools(), which sideagent needs for tool calling.");
  const model = baseModel.bindTools(toolDefs, bindOptions);

  const audit = (e: AuditEvent) => {
    try {
      void Promise.resolve(onAudit?.({ ...e, args: redact(e.args) })).catch(() => {});
    } catch {
      /* audit must never break a turn */
    }
  };

  async function agentNode(state: typeof MessagesAnnotation.State, cfg: any) {
    const run = cfg.configurable.run as RunContext;
    const system = new SystemMessage(buildSystemPrompt(config.instructions, run.context, !!knowledge));
    const reply = await model.invoke([system, ...state.messages], { signal: cfg.signal });
    return { messages: [reply] };
  }

  async function toolsNode(state: typeof MessagesAnnotation.State, cfg: any) {
    const run = cfg.configurable.run as RunContext;
    const threadId = cfg.configurable.thread_id as string;
    const write = (e: unknown) => cfg.writer?.(e);
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = last.tool_calls ?? [];
    const out: ToolMessage[] = [];

    // Only the first call runs: a node that pauses for approval is re-executed on resume,
    // so running several calls here could repeat a mutation.
    for (const skipped of calls.slice(1)) {
      out.push(new ToolMessage({ tool_call_id: skipped.id!, content: "Skipped: call one tool at a time and retry." }));
    }
    const call = calls[0];
    if (!call) return { messages: out };
    const callId = call.id!;
    const base = { at: Date.now(), userId: run.userId, threadId, operationId: call.name, callId };

    if (knowledge && call.name === SEARCH_TOOL) {
      const query = typeof (call.args as any)?.query === "string" ? ((call.args as any).query as string).trim().slice(0, 300) : "";
      if (!query) {
        return { messages: [new ToolMessage({ tool_call_id: callId, content: "Error: query is required.", artifact: { result: { error: "query is required" } } }), ...out] };
      }
      write({ type: "tool.start", callId, operationId: SEARCH_TOOL });
      const started = Date.now();
      try {
        const hits = await knowledge.search(query);
        const sources = uniqueSources(hits);
        audit({ ...base, args: { query }, status: "executed", approval: "auto", durationMs: Date.now() - started });
        // The browser only gets source titles and config-provided URLs, never passage text.
        write({ type: "tool.complete", callId, operationId: SEARCH_TOOL, status: 200, args: { query }, result: { sources }, invalidates: [] });
        return {
          messages: [
            new ToolMessage({ tool_call_id: callId, content: wrapKnowledge(hits, config.limits.maxResultBytes), artifact: { result: { sources } } }),
            ...out,
          ],
        };
      } catch (e) {
        const msg = (e as Error).message;
        audit({ ...base, args: { query }, status: "error", approval: "auto", error: msg });
        write({ type: "tool.complete", callId, operationId: SEARCH_TOOL, status: 0, args: { query }, result: { error: "Knowledge search is unavailable." }, invalidates: [] });
        return { messages: [new ToolMessage({ tool_call_id: callId, content: "Error: knowledge search is unavailable.", artifact: { result: { error: "Knowledge search is unavailable." } } }), ...out] };
      }
    }

    const op = byName.get(call.name);
    if (!op) {
      audit({ ...base, args: call.args, status: "denied", approval: "auto", error: "not allowlisted" });
      return { messages: [new ToolMessage({ tool_call_id: callId, content: `Error: unknown tool "${call.name}".`, artifact: { result: { error: "not available" } } }), ...out] };
    }

    let args: Record<string, any>;
    try {
      args = validateArgs(op, call.args);
    } catch (e) {
      const msg = (e as Error).message;
      audit({ ...base, args: call.args, status: "error", approval: "auto", error: msg });
      return { messages: [new ToolMessage({ tool_call_id: callId, content: `Error: invalid arguments: ${msg}`, artifact: { result: { error: "invalid arguments" } } }), ...out] };
    }

    let approval: AuditEvent["approval"] = "auto";
    if (op.needsApproval) {
      const claims = { threadId, callId, operationId: op.operationId, args };
      const { token, expiresAt } = await signApproval(secret, claims, APPROVAL_TTL_MS);
      const pending: PendingApproval = {
        callId,
        operationId: op.operationId,
        method: op.method.toUpperCase(),
        path: op.path,
        args,
        token,
        expiresAt,
      };
      const answer = interrupt(pending) as { decision: "approve" | "reject" };
      if (answer.decision !== "approve") {
        audit({ ...base, args, status: "rejected", approval: "rejected" });
        write({ type: "tool.rejected", callId, operationId: op.operationId });
        return {
          messages: [new ToolMessage({ tool_call_id: callId, content: "The user rejected this action. Do not retry it.", artifact: { result: { rejected: true } } }), ...out],
        };
      }
      approval = "approved";
    }

    write({ type: "tool.start", callId, operationId: op.operationId });
    const started = Date.now();
    try {
      const res = await executeOperation(
        op,
        args,
        {
          baseUrl: config.baseUrl,
          headers: run.headers,
          callTimeoutMs: config.limits.callTimeoutMs,
          maxResultBytes: config.limits.maxResultBytes,
          allowPrivateNetworks: config.allowPrivateNetworks,
        },
        cfg.signal,
      );
      audit({ ...base, args, status: "executed", approval, httpStatus: res.status, durationMs: Date.now() - started });
      write({
        type: "tool.complete",
        callId,
        operationId: op.operationId,
        status: res.status,
        args,
        result: res.body,
        invalidates: res.status < 400 ? (op.ext.invalidates ?? []) : [],
      });
      return {
        messages: [
          new ToolMessage({
            tool_call_id: callId,
            content: wrapToolResult(op.operationId, res.status, res.body, res.truncated),
            // Already filtered by responseFields and size-capped; used to rebuild history.
            artifact: { result: res.body },
          }),
          ...out,
        ],
      };
    } catch (e) {
      const msg = (e as Error).message;
      audit({ ...base, args, status: "error", approval, durationMs: Date.now() - started, error: msg });
      write({ type: "tool.complete", callId, operationId: op.operationId, status: 0, args, result: { error: msg }, invalidates: [] });
      return { messages: [new ToolMessage({ tool_call_id: callId, content: `Error calling ${op.operationId}: ${msg}`, artifact: { result: { error: msg } } }), ...out] };
    }
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

export { Command };
