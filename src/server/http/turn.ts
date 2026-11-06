import type { Callbacks } from "@langchain/core/callbacks/manager";
import { HumanMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";
import type { AgentEvent } from "../../protocol.js";
import type { AgentConfig } from "../config.js";
import { MODEL_NODE, type AgentGraph } from "../graph/index.js";
import { messageText } from "../message-text.js";
import { threadPrefix, titleFrom, type ThreadStore } from "../threads.js";
import type { TurnBody } from "./request.js";

export interface TurnErrorContext {
  /** What the browser is told: `error` for any failure it gets no detail on. */
  code: "error" | "step_limit" | "timeout";
  error: unknown;
  userId: string;
  threadId: string;
}

export interface TurnDeps {
  config: AgentConfig;
  graph: AgentGraph;
  threads: ThreadStore;
  onError?: (ctx: TurnErrorContext) => void | Promise<void>;
  /** Gives back the slot the handler reserved for this turn (see slots.ts). Called once the stream ends. */
  release: () => void;
}

export interface TurnAuth {
  userId: string;
  exposeKnowledge?: boolean;
  callbacks?: Callbacks;
}

/** Starts a turn and streams its events as SSE. */
export async function runTurn(
  request: Request,
  body: TurnBody,
  auth: TurnAuth,
  deps: TurnDeps,
  cors: Record<string, string>,
): Promise<Response> {
  const { config, graph, threads, release, onError } = deps;
  const { userId } = auth;
  const threadId = body.threadId ?? `${threadPrefix(userId)}${crypto.randomUUID()}`;
  const runCfg = {
    configurable: {
      thread_id: threadId,
      run: {
        userId,
        context: body.context,
        exposeKnowledge: auth.exposeKnowledge === true,
      },
    },
  };

  await threads.touch(userId, threadId, titleFrom(body.message));
  const timeout = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort(new Error("turn timed out"));
  }, config.limits.turnTimeoutMs);
  request.signal.addEventListener("abort", () => timeout.abort(), { once: true });

  const encoder = new TextEncoder();
  // The reader left (closed the tab, aborted fetch): stop the model and the tools instead of finishing for nobody.
  let cancelled = false;
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
        const events = await graph.stream(
          { messages: [new HumanMessage(body.message)] },
          {
            ...runCfg,
            signal: timeout.signal,
            ...(auth.callbacks && { callbacks: auth.callbacks }),
            recursionLimit: config.limits.maxSteps * 2 + 2,
            streamMode: ["messages", "custom"],
          },
        );
        for await (const [mode, chunk] of events as AsyncIterable<[string, any]>) {
          if (mode === "custom") send(chunk as AgentEvent);
          else if (mode === "messages") {
            const [msg, meta] = chunk;
            // Content is a string for most providers and an array of blocks for others (Anthropic, some
            // gateways); only the text blocks are for the user.
            const text = meta?.langgraph_node === MODEL_NODE ? messageText(msg.content) : "";
            if (text) send({ type: "text.delta", text });
          }
        }
      } catch (e) {
        const code = e instanceof GraphRecursionError ? "step_limit" : timedOut ? "timeout" : "error";
        // Fixed wording: the raw step-limit error names framework internals and a troubleshooting URL.
        const message =
          code === "step_limit"
            ? "The agent needed too many steps for this question. Try a simpler or more specific one."
            : code === "timeout"
              ? "turn timed out"
              : "The agent failed. Try again.";
        send({ type: "error", code, message });
        // A client that went away is not a failure.
        if (!request.signal.aborted && !cancelled) {
          void Promise.resolve()
            .then(() => onError?.({ code, error: e, userId, threadId }))
            .catch(() => {});
        }
      } finally {
        clearTimeout(timer);
        release();
        send({ type: "turn.end" });
        try {
          controller.close();
        } catch {
          /* the reader cancelled */
        }
      }
    },
    cancel() {
      cancelled = true;
      timeout.abort();
    },
  });

  return new Response(stream, {
    headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}
