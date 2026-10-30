import type { ToolMessage } from "@langchain/core/messages";
import { SEARCH_TOOL, uniqueSources, wrapKnowledge, type KnowledgeBase } from "../../knowledge/index.js";
import { toolResult, type ToolContext } from "./context.js";

export const SEARCH_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: SEARCH_TOOL,
    description: "Search the application's documentation and knowledge base. Returns relevant passages.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

export async function runSearch(
  knowledge: KnowledgeBase,
  rawArgs: unknown,
  maxResultBytes: number,
  ctx: ToolContext,
  minScore = 0,
): Promise<ToolMessage> {
  const { callId, write } = ctx;
  const q = (rawArgs as { query?: unknown } | undefined)?.query;
  const query = typeof q === "string" ? q.trim().slice(0, 300) : "";
  if (!query) return toolResult(callId, "Error: query is required.", { error: "query is required" });

  write({ type: "tool.start", callId, tool: SEARCH_TOOL });
  try {
    const hits = await knowledge.search(query);
    const sources = uniqueSources(hits);
    // The browser only gets source titles and config-provided URLs, never passage text.
    write({
      type: "tool.complete",
      callId,
      tool: SEARCH_TOOL,
      status: 200,
      args: { query },
      result: { sources },
    });
    // Host opt-in only (see exposeKnowledge): passage text is otherwise for the model alone.
    if (ctx.run.exposeKnowledge) {
      write({
        type: "knowledge.hits",
        callId,
        query,
        hits: hits.map((h) => ({
          title: h.meta.title,
          ...(h.meta.url ? { url: h.meta.url } : {}),
          score: h.score,
          text: h.text,
        })),
      });
    }
    return toolResult(
      callId,
      wrapKnowledge(hits, maxResultBytes),
      { sources },
      hits.some((h) => h.score >= minScore),
    );
  } catch {
    const error = "Knowledge search is unavailable.";
    write({
      type: "tool.complete",
      callId,
      tool: SEARCH_TOOL,
      status: 0,
      args: { query },
      result: { error },
    });
    return toolResult(callId, "Error: knowledge search is unavailable.", { error });
  }
}
