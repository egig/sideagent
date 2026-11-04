import { ensureAsyncLocalStorage } from "./als.js";
import { parseConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { buildGraph } from "./graph/index.js";
import { createHandler } from "./http/handler.js";
import { createLlmReranker } from "./knowledge/reranker.js";
import { startKnowledge } from "./knowledge/startup.js";
import { createChatModel } from "./model.js";
import type { CreateAgentOptions } from "./options.js";
import { MemoryThreadStore, type ThreadStore } from "./threads.js";

export type { AuthResult } from "./http/handler.js";
export type { DoctorReport } from "./doctor.js";
export type { EmbeddingsLike } from "./model.js";
export type { CreateAgentOptions } from "./options.js";

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
    reranker,
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

  const model = givenModel ?? createChatModel(config.llm!);
  const ranker = reranker === true ? createLlmReranker(model) : reranker;
  const knowledge = await startKnowledge(config, givenEmbeddings, vectorStore, ranker);
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

export type Agent = Awaited<ReturnType<typeof createAgent>>;
