import type { AgentEvent, HistoryMessage } from "../protocol.js";
import { pretty } from "./format.js";

/** assistant-ui message content parts, as built from server events and history. */
export type Part =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      argsText: string;
      result?: unknown;
    };

type ToolPatch = Partial<Omit<Extract<Part, { type: "tool-call" }>, "type" | "toolCallId">>;

function upsertTool(parts: readonly Part[], callId: string, patch: ToolPatch): Part[] {
  const i = parts.findIndex((p) => p.type === "tool-call" && p.toolCallId === callId);
  if (i < 0)
    return [...parts, { type: "tool-call", toolCallId: callId, toolName: "", args: {}, argsText: "{}", ...patch }];
  return parts.map((p, j) => (j === i ? ({ ...p, ...patch } as Part) : p));
}

// `any` values: assistant-ui wants JSON-typed args, and these came from JSON.
const argsOf = (v: unknown) => (v ?? {}) as Record<string, any>;

/** Pure: returns the parts after one server event. Side effects (hooks, thread id) stay with the caller. */
export function applyEvent(parts: readonly Part[], ev: AgentEvent): Part[] {
  switch (ev.type) {
    case "text.delta": {
      const tail = parts[parts.length - 1];
      if (tail?.type === "text") return [...parts.slice(0, -1), { type: "text", text: tail.text + ev.text }];
      return [...parts, { type: "text", text: ev.text }];
    }
    case "tool.start":
      return upsertTool(parts, ev.callId, { toolName: ev.tool });
    case "knowledge.hits": {
      // After tool.complete: fold the passages into the search call's result for the card to show.
      const prev = parts.find((p) => p.type === "tool-call" && p.toolCallId === ev.callId);
      const base = prev?.type === "tool-call" && prev.result && typeof prev.result === "object" ? prev.result : {};
      return upsertTool(parts, ev.callId, { result: { ...base, hits: ev.hits } });
    }
    case "tool.complete":
      return upsertTool(parts, ev.callId, {
        toolName: ev.tool,
        args: argsOf(ev.args),
        argsText: pretty(ev.args),
        result: ev.result ?? null,
      });
    case "error":
      return [...parts, { type: "text", text: `⚠ ${ev.message}` }];
    default:
      return [...parts];
  }
}

/** Server history (threads.get) to assistant-ui initial messages. */
export function toInitialMessages(messages: HistoryMessage[] | undefined) {
  return (messages ?? []).map((m) =>
    m.role === "user"
      ? {
          role: "user" as const,
          content: m.parts.map((p) => ({ type: "text" as const, text: p.type === "text" ? p.text : "" })),
        }
      : {
          role: "assistant" as const,
          content: m.parts.map((p) =>
            p.type === "text"
              ? { type: "text" as const, text: p.text }
              : {
                  type: "tool-call" as const,
                  toolCallId: p.callId,
                  toolName: p.tool,
                  args: argsOf(p.args),
                  argsText: pretty(p.args),
                  result: p.result,
                },
          ),
          status: { type: "complete" as const, reason: "stop" as const },
        },
  );
}
