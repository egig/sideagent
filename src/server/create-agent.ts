import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ensureAsyncLocalStorage } from "./als.js";
import { parseConfig, type AgentConfig, type AgentConfigInput } from "./config.js";
import { runDoctor } from "./doctor.js";
import { buildGraph } from "./graph/index.js";
import { createHandler, type AuthResult } from "./http/handler.js";
import type { TurnErrorContext } from "./http/turn.js";
import { KnowledgeBase, SEARCH_TOOL, type VectorStore } from "./knowledge/index.js";
import { createChatModel, createEmbeddings, type EmbeddingsLike } from "./model.js";
import { loadOperations, type Operation } from "./openapi.js";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { AuditEvent } from "./security/policy.js";
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
   * Return true to run this request as a dry run: operations that are not plain reads (GET, HEAD) still
   * ask for approval, but are not sent to your API after it. The model and the user are told so. For
   * previews and demos. Decided on the server per request; a callback that throws counts as true.
   */
  dryRun?: (ctx: { request: Request; userId: string }) => boolean | Promise<boolean>;
  onAudit?: (event: AuditEvent) => void | Promise<void>;
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
    dryRun,
    callbacks,
    onAudit,
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
  const ops =
    config.spec && config.allow.length ? await loadOperations(config.spec, config.allow, config.limits.maxTools) : [];

  const secret: string = config.approvalSecret ?? crypto.randomUUID() + crypto.randomUUID();
  if (!config.approvalSecret) {
    console.warn(
      "[sideagent] approvalSecret not set: using a random per-instance secret. Set it on serverless/multi-instance deployments.",
    );
  }
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

  const knowledge = config.knowledge ? await startKnowledge(config, ops, givenEmbeddings, vectorStore) : undefined;
  const model = givenModel ?? createChatModel(config.llm!);
  const graph = buildGraph({
    config,
    ops,
    secret,
    checkpointer,
    onAudit,
    knowledge,
    model,
    bindOptions: givenModel ? undefined : { parallel_tool_calls: false },
  });
  const handler = createHandler({
    config,
    graph,
    threads,
    secret,
    getAuth,
    beforeTurn,
    exposeKnowledge,
    dryRun,
    callbacks,
    onError,
  });

  return {
    handler,
    doctor: () => runDoctor({ config, ops, givenModel, knowledge }),
    tools: ops.map((o) => o.operationId),
    knowledge,
  };
}

async function startKnowledge(
  config: AgentConfig,
  ops: Operation[],
  givenEmbeddings: EmbeddingsLike | undefined,
  store: VectorStore | undefined,
) {
  if (ops.some((o) => o.operationId === SEARCH_TOOL)) {
    throw new Error(`An allowlisted operation is named "${SEARCH_TOOL}", which is reserved for knowledge search`);
  }
  const k = config.knowledge!;
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
