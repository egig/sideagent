import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { AgentConfigInput } from "./config.js";
import type { AuthResult } from "./http/handler.js";
import type { TurnErrorContext } from "./http/turn.js";
import type { KnowledgeRerankerOption, VectorStore } from "./knowledge/index.js";
import type { EmbeddingsLike } from "./model.js";
import type { ThreadStore } from "./threads.js";

export interface CreateAgentOptions extends AgentConfigInput {
  /** Your own chat model (e.g. workersAiChatModel from sideagent/workers-ai). Use instead of `llm`, never with it. It must support bindTools(). */
  model?: BaseChatModel;
  /** Your own embeddings, used instead of knowledge.embeddings. */
  embeddings?: EmbeddingsLike;
  getAuth?: (request: Request) => AuthResult | Promise<AuthResult>;
  /** Throw to reject a turn (rate limiting, quota). */
  beforeTurn?: (ctx: { request: Request; userId: string }) => void | Promise<void>;
  /**
   * Return true to stream the passages of knowledge searches to this request's browser (`knowledge.hits`
   * events), for example for a signed-in owner previewing their agent. Off by default. Decided here on the
   * server per request; nothing in the request body can turn it on.
   */
  exposeKnowledge?: (ctx: { request: Request; userId: string }) => boolean | Promise<boolean>;
  /**
   * LangChain callback handlers for this request's turn, to trace what happens under the hood: model calls,
   * tool calls, token usage, errors. Decided here on the server per request; nothing in the request body
   * can set it. What the handlers see is unredacted (prompts, replies, tool arguments and results), so
   * redact before storing. A callback that throws means no tracing; a failing handler never breaks the turn.
   */
  callbacks?: (ctx: { request: Request; userId: string }) => Callbacks | undefined | Promise<Callbacks | undefined>;
  /**
   * Called when a turn fails, with the real error. The browser only sees "The agent failed" (or the step limit
   * or timeout message), so use this to log the cause. Fire-and-forget; errors thrown here are swallowed.
   */
  onError?: (ctx: TurnErrorContext) => void | Promise<void>;
  checkpointer?: BaseCheckpointSaver;
  /** Index of each user's conversations (history list). Defaults to in-memory. */
  threadStore?: ThreadStore;
  /** Where knowledge embeddings live. Defaults to in-memory (re-embedded on every start). */
  vectorStore?: VectorStore;
  /** Optional second-stage ranker for retrieved passages. Return one higher-is-better score per candidate. */
  reranker?: KnowledgeRerankerOption;
}
