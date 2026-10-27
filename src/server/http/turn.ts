import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { AgentEvent } from "../../protocol.js";
import { verifyApproval } from "../security/approval.js";
import type { AgentConfig } from "../config.js";
import { pendingApprovalOf, type AgentGraph } from "../graph/index.js";
import { threadPrefix, titleFrom, type ThreadStore } from "../threads.js";
import { json } from "./json.js";
import type { TurnBody } from "./request.js";

export interface TurnDeps {
  config: AgentConfig;
  graph: AgentGraph;
  threads: ThreadStore;
  secret: string;
  /** Turns in flight per user; incremented here, decremented when the stream ends. */
  active: Map<string, number>;
}

export interface TurnAuth {
  userId: string;
  headers: Record<string, string>;
}

/** Starts (or resumes, after an approval decision) a turn and streams its events as SSE. */
export async function runTurn(request: Request, body: TurnBody, auth: TurnAuth, deps: TurnDeps, cors: Record<string, string>): Promise<Response> {
  const { config, graph, threads, secret, active } = deps;
  const { userId } = auth;
  const threadId = body.threadId ?? `${threadPrefix(userId)}${crypto.randomUUID()}`;
  const runCfg = { configurable: { thread_id: threadId, run: { userId, headers: auth.headers, context: "message" in body ? body.context : undefined } } };

  const pending = body.threadId ? pendingApprovalOf(await graph.getState(runCfg)) : undefined;

  let input: Command | { messages: HumanMessage[] };
  if ("approval" in body) {
    if (!pending) return json(409, { error: "no pending approval" }, cors);
    const ok =
      body.approval.token === pending.token &&
      (await verifyApproval(secret, body.approval.token, {
        threadId,
        callId: pending.callId,
        operationId: pending.operationId,
        args: pending.args,
      }));
    if (!ok) return json(403, { error: "invalid or expired approval" }, cors);
    input = new Command({ resume: { decision: body.approval.decision } });
  } else {
    if (pending) return json(409, { error: "resolve the pending approval first" }, cors);
    input = { messages: [new HumanMessage(body.message)] };
  }

  await threads.touch(userId, threadId, titleFrom("message" in body ? body.message : ""));
  active.set(userId, (active.get(userId) ?? 0) + 1);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("turn timed out")), config.limits.turnTimeoutMs);
  request.signal.addEventListener("abort", () => timeout.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client went away */
        }
      };
      send({ type: "turn.start", threadId });
      try {
        const events = await graph.stream(input as any, {
          ...runCfg,
          signal: timeout.signal,
          recursionLimit: config.limits.maxSteps * 2 + 2,
          streamMode: ["messages", "custom"],
        });
        for await (const [mode, chunk] of events as AsyncIterable<[string, any]>) {
          if (mode === "custom") send(chunk as AgentEvent);
          else if (mode === "messages") {
            const [msg, meta] = chunk;
            if (meta?.langgraph_node === "agent" && typeof msg.content === "string" && msg.content) {
              send({ type: "text.delta", text: msg.content });
            }
          }
        }
        const waiting = pendingApprovalOf(await graph.getState(runCfg));
        if (waiting) send({ type: "approval.request", ...waiting });
      } catch (e) {
        const msg = (e as Error).message ?? "error";
        const code = /recursion/i.test(msg) ? "step_limit" : /timed out/i.test(msg) ? "timeout" : "error";
        send({ type: "error", code, message: code === "error" ? "The agent failed. Try again." : msg });
      } finally {
        clearTimeout(timer);
        active.set(userId, Math.max(0, (active.get(userId) ?? 1) - 1));
        send({ type: "turn.end" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}
