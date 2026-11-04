// Runs a hosted agent with the sideagent library (D-24): it answers from the agent's knowledge, with
// history for a signed-in user. The model is the host's built-in one (D-18) or the integrator's own OpenAI-compatible
// endpoint, reached through the SSRF guard (D-30). One library agent per
// (agent, config version, mode), cached in memory.
import { MemorySaver } from "@langchain/langgraph";
import { Document } from "@langchain/core/documents";
import { VectorStore } from "@langchain/core/vectorstores";
import { createAgent, type Agent, type AuthResult, type CreateAgentOptions } from "../../server/index.js";
import { open } from "../crypto.js";
import { DEFAULT_TRACE_LEVEL } from "../config.js";
import type { AdminDeps } from "../deps.js";
import { guardedFetch } from "../guarded-fetch.js";
import { embeddingKey } from "../llm.js";
import type { AgentRecord, Hit } from "../store/types.js";
import { StoreCheckpointer } from "./checkpointer.js";
import { MIN_SCORE, OFF_TOPIC, TOP_K } from "./answer.js";
import { isPreviewUser } from "./preview.js";
import { TraceHandler } from "./trace.js";

/** The agent's own store as a LangChain vector store the library can search. Writes are no-ops: the control plane indexes. */
class StoreVectorStore extends VectorStore {
  constructor(private find: (vector: number[], k: number) => Promise<Hit[]>) {
    super({} as never, {});
  }
  _vectorstoreType() {
    return "sideagent-admin";
  }
  async addVectors() {}
  async addDocuments() {}
  async delete() {}
  async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Document, number][]> {
    return (await this.find(query, k)).map((h) => [new Document({ pageContent: h.text, metadata: h.meta }), h.score]);
  }
}

/** One retry: the SSRF guard's refusals and dead hosts should fail in seconds, not after the clients' full backoff (D-30). */
const LLM_RETRIES = 1;
const CACHE_MAX = 50;
const TITLE_MAX = 80;
/** Auth for the request being handled. The agent is shared between requests, so it cannot hold it. */
const authOf = new WeakMap<Request, AuthResult>();
/** The id the router gave a turn, so its trace row carries the same id as its audit row. */
const turnOf = new WeakMap<Request, string>();

/**
 * What a request may use.
 * - docs: knowledge with a signed-in user's history.
 * - anon: knowledge only, nobody signed in. Nothing is kept: each request is its own user and thread.
 */
export type Mode = "docs" | "anon";

const EPHEMERAL_THREADS = 200;

/** Checkpoints for anonymous turns, in memory and bounded: the oldest threads are dropped. */
class EphemeralSaver extends MemorySaver {
  private threads: string[] = [];
  override async put(...args: Parameters<MemorySaver["put"]>) {
    const id = args[0].configurable?.thread_id as string | undefined;
    if (id && !this.threads.includes(id)) {
      this.threads.push(id);
      while (this.threads.length > EPHEMERAL_THREADS) await this.deleteThread(this.threads.shift()!);
    }
    return super.put(...args);
  }
}

const NO_THREADS = { list: async () => [], has: async () => false, touch: async () => {}, delete: async () => {} };

/** Records what an object's async methods (promises or async generators) throw, then rethrows it. */
function watch<T extends object>(target: T, methods: string[], onError: (e: unknown) => void): T {
  for (const name of methods) {
    const original = (target as Record<string, unknown>)[name];
    if (typeof original !== "function") continue;
    (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      try {
        const out = original.apply(this, args);
        if (out && typeof (out as AsyncGenerator).next === "function" && Symbol.asyncIterator in (out as object)) {
          return (async function* () {
            try {
              yield* out as AsyncGenerator;
            } catch (e) {
              onError(e);
              throw e;
            }
          })();
        }
        return out instanceof Promise ? out.catch((e: unknown) => (onError(e), Promise.reject(e))) : out;
      } catch (e) {
        onError(e);
        throw e;
      }
    };
  }
  return target;
}

export function createRuntime(deps: AdminDeps) {
  const cache = new Map<string, { key: string; agent: Promise<Agent> }>();
  // The last model or embeddings failure per agent. The library tells the browser only "the agent
  // failed"; this lets the router audit it as a provider failure and tell the previewing owner why.
  const failures = new Map<string, unknown>();
  const failed = (agentId: string, e: unknown) => failures.set(agentId, e);

  async function build(row: AgentRecord, allowedOrigins: string[], mode: Mode): Promise<Agent> {
    const llm = row.config.llm;
    // Built-in: the host's model for chat and embeddings. Custom: the library talks to the integrator's endpoint with
    // a guarded fetch, for the chat model and for query embeddings (D-30).
    let provider: Pick<CreateAgentOptions, "model" | "embeddings" | "llm"> & {
      embeddingsConfig?: { model: string; fetch: typeof fetch; maxRetries: number };
    };
    if (llm?.provider === "builtin") {
      if (!deps.builtin) throw new Error("no built-in model");
      provider = deps.builtin.models((e) => failed(row.id, e));
    } else {
      if (!llm || !row.llmKeySealed) throw new Error("no llm key");
      const inner = guardedFetch(deps.resolve, deps.fetch);
      const guarded: typeof fetch = async (input, init) => {
        const res = await inner(input, init).catch((e: unknown) => (failed(row.id, e), Promise.reject(e)));
        if (!res.ok) failed(row.id, new Error(`provider answered HTTP ${res.status}`));
        return res;
      };
      provider = {
        llm: {
          baseUrl: llm.baseUrl,
          apiKey: await open(deps.secrets, row.id, "llmKey", row.llmKeySealed),
          model: llm.model,
          fetch: guarded,
          maxRetries: LLM_RETRIES,
        },
        embeddingsConfig: { model: llm.embeddingModel, fetch: guarded, maxRetries: LLM_RETRIES },
      };
    }
    const key = embeddingKey(deps, row.config);
    const ephemeral = mode === "anon" ? new EphemeralSaver() : null;
    const threads = deps.store.threads;
    return createAgent({
      allowedOrigins,
      instructions: row.config.instructions || undefined,
      model: provider.model,
      embeddings: provider.embeddings,
      llm: provider.llm,
      // The library wants at least one source to turn knowledge on. This one is embedded once and
      // never stored (writes are no-ops); searches go to the agent's own knowledge.
      // Keeps the agent on the documentation, in code (D-20).
      scope: { minScore: MIN_SCORE, offTopic: OFF_TOPIC },
      knowledge: {
        topK: TOP_K,
        sources: [{ id: "placeholder", title: "placeholder", content: "placeholder" }],
        ...(provider.embeddingsConfig && { embeddings: provider.embeddingsConfig }),
      },
      vectorStore: new StoreVectorStore((vector, k) =>
        deps.store.knowledge
          .search(row.id, vector, k, key)
          .catch((e: unknown) => (failed(row.id, e), Promise.reject(e))),
      ),
      checkpointer:
        ephemeral ??
        watch(new StoreCheckpointer(row.id, threads), ["getTuple", "list", "put", "putWrites"], (e) =>
          failed(row.id, e),
        ),
      threadStore: ephemeral
        ? NO_THREADS
        : {
            list: (userId) => threads.list(row.id, userId),
            has: (userId, threadId) => threads.has(row.id, userId, threadId),
            touch: (userId, threadId, title) =>
              threads.touch(row.id, userId, threadId, title.slice(0, TITLE_MAX), Date.now()),
            delete: (userId, threadId) => threads.delete(row.id, userId, threadId),
          },
      // Preview turns (D-31) show the owner the retrieved passages. Decided here from the user id the
      // server assigned, never from anything the client sent.
      exposeKnowledge: ({ userId }) => isPreviewUser(userId),
      getAuth: (request) => {
        const auth = authOf.get(request);
        if (!auth) throw new Error("no auth");
        return auth;
      },
      // The browser only hears "the agent failed". With `debug` the log gets the error itself; off otherwise,
      // because provider errors can echo keys and customer text.
      onError: deps.debug
        ? ({ error, code, threadId }) => console.error("agent turn error", { agentId: row.id, code, threadId }, error)
        : undefined,
      // What happened under the hood, per the agent's tracing level (D-35). One row per turn, written when the turn ends.
      callbacks: ({ request, userId }) => {
        const level = row.config.tracing ?? DEFAULT_TRACE_LEVEL;
        if (level === "off") return undefined;
        return [
          new TraceHandler({
            agentId: row.id,
            userId,
            level,
            id: turnOf.get(request),
            write: (t, id) => deps.store.audit.recordTrace(row.id, t, id),
          }),
        ];
      },
    });
  }

  function agentFor(row: AgentRecord, allowedOrigins: string[], mode: Mode): Promise<Agent> {
    const key = `${row.configVersion}`;
    const id = `${row.id}:${mode}`;
    let entry = cache.get(id);
    if (!entry || entry.key !== key) {
      const agent = build(row, allowedOrigins, mode);
      entry = { key, agent };
      cache.delete(id);
      cache.set(id, entry);
      // A failed build must not stick.
      agent.catch(() => cache.get(id)?.agent === agent && cache.delete(id));
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return entry.agent;
  }

  return {
    /** The provider failure behind the last failed turn of this agent, once. */
    takeFailure(agentId: string): unknown {
      const e = failures.get(agentId);
      failures.delete(agentId);
      return e;
    },
    /** `allowedOrigins` changes only with the config version (part of the cache key), or not at all for the dashboard agent. */
    async handle(
      row: AgentRecord,
      request: Request,
      auth: AuthResult,
      allowedOrigins: string[],
      mode: Mode,
      turnId?: string,
    ): Promise<Response> {
      const agent = await agentFor(row, allowedOrigins, mode);
      authOf.set(request, auth);
      if (turnId) turnOf.set(request, turnId);
      return agent.handler(request);
    },
  };
}
