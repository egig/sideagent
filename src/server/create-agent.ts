import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ensureAsyncLocalStorage } from "./als.js";
import { parseConfig, type AgentConfig, type AgentConfigInput } from "./config.js";
import { runDoctor } from "./doctor.js";
import { buildGraph } from "./graph/index.js";
import { createHandler, type AuthResult } from "./http/handler.js";
import type { TurnErrorContext } from "./http/turn.js";
import { KnowledgeBase, type VectorStore } from "./knowledge/index.js";
import { createChatModel, createEmbeddings, type EmbeddingsLike } from "./model.js";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { MemoryThreadStore, type ThreadStore } from "./threads.js";

export type { AuthResult } from "./http/handler.js";
export type { DoctorReport } from "./doctor.js";
export type { EmbeddingsLike } from "./model.js";

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
}

const KNOWLEDGE_STARTUP_WAIT_MS = 60_000;

export async function createAgent(options: CreateAgentOptions) {
  const {
    getAuth,
    beforeTurn,
    exposeKnowledge,
    callbacks,
    onError,
    checkpointer,
    threadStore: givenStore,
    vectorStore,
    model: givenModel,
    embeddings: givenEmbeddings,
    ...data
  } = options;
  await ensureAsyncLocalStorage();
  const config = parseConfig(data, !!getAuth, { model: !!givenModel, embeddings: !!givenEmbeddings });
  const threads: ThreadStore = givenStore ?? new MemoryThreadStore();
  if (checkpointer && !givenStore) {
    console.warn(
      "[sideagent] persistent checkpointer without a threadStore: the history list is in-memory and will not survive restarts.",
    );
  }
  if (!checkpointer) {
    console.warn(
      "[sideagent] using the in-memory checkpointer: conversations are lost on restart. Pass a persistent checkpointer for production.",
    );
  }

  const knowledge = await startKnowledge(config, givenEmbeddings, vectorStore);
  const model = givenModel ?? createChatModel(config.llm!);
  const graph = buildGraph({ config, checkpointer, knowledge, model });
  const handler = createHandler({
    config,
    graph,
    threads,
    getAuth,
    beforeTurn,
    exposeKnowledge,
    callbacks,
    onError,
  });

  return {
    handler,
    doctor: () => runDoctor({ config, givenModel, knowledge }),
    knowledge,
  };
}

async function startKnowledge(
  config: AgentConfig,
  givenEmbeddings: EmbeddingsLike | undefined,
  store: VectorStore | undefined,
) {
  const k = config.knowledge;
  // parseConfig guarantees exactly one of the two sources
  const embedder = givenEmbeddings ?? createEmbeddings(k.embeddings!, config.llm);
  const knowledge = new KnowledgeBase(k, {
    embedDocuments: (t) => embedder.embedDocuments(t),
    embedQuery: (t) => embedder.embedQuery(t),
    store,
    allowPrivateNetworks: config.allowPrivateNetworks,
  });
  // Don't let a slow or dead embeddings host block startup forever; loading continues in the background.
  const loading = knowledge.load();
  const timedOut = await Promise.race([
    loading.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), KNOWLEDGE_STARTUP_WAIT_MS)),
  ]);
  if (timedOut)
    console.warn(
      "[sideagent] knowledge is still loading after 60s; search results may be incomplete until it finishes.",
    );
  return knowledge;
}

export type Agent = Awaited<ReturnType<typeof createAgent>>;
