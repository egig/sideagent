// Runs a hosted agent with the sideagent library (D-24): it answers from the agent's knowledge, with
// history for a signed-in user. The model is the host's built-in one (D-18) or the integrator's own OpenAI-compatible
// endpoint, reached through the SSRF guard (D-30). One library agent per
// (agent, config version, mode), cached in memory.
import { type Agent, type AuthResult, createAgent } from "../../server/index.js";
import { DEFAULT_TRACE_LEVEL } from "../config.js";
import { ANON_THREAD_TTL_MS, ANON_USER_PREFIX, PRUNE_ODDS } from "../retention.js";
import type { AdminDeps } from "../deps.js";
import { embeddingKey } from "../llm.js";
import type { AgentRecord } from "../store/types.js";
import { StoreCheckpointer } from "./adapters/checkpointer.js";
import { TraceHandler } from "./adapters/trace.js";
import { StoreVectorStore } from "./adapters/vector-store.js";
import { watch } from "./adapters/watch.js";
import { MIN_SCORE, OFF_TOPIC, TOP_K } from "./limits.js";
import { isPreviewUser } from "./preview.js";
import { buildProvider } from "./provider.js";

const CACHE_MAX = 50;
const TITLE_MAX = 80;
/** Auth for the request being handled. The agent is shared between requests, so it cannot hold it. */
const authOf = new WeakMap<Request, AuthResult>();
/** The id the router gave a turn, so its trace row carries the same id as its audit row. */
const turnOf = new WeakMap<Request, string>();

/**
 * What a request may use.
 * - docs: knowledge with a signed-in user's history.
 * - anon: knowledge only, nobody signed in. A conversation is kept for ANON_THREAD_TTL_MS after its last message.
 */
export type Mode = "docs" | "anon";

export function createRuntime(deps: AdminDeps) {
  const cache = new Map<string, { key: string; agent: Promise<Agent> }>();
  // The last model or embeddings failure per agent. The library tells the browser only "the agent
  // failed"; this lets the router audit it as a provider failure and tell the previewing owner why.
  const failures = new Map<string, unknown>();
  const failed = (agentId: string, e: unknown) => failures.set(agentId, e);

  async function build(row: AgentRecord, allowedOrigins: string[], mode: Mode): Promise<Agent> {
    const provider = await buildProvider(deps, row, failed);
    const key = embeddingKey(deps, row.config);
    const threads = deps.store.threads;
    const now = deps.now ?? Date.now;
    return createAgent({
      allowedOrigins,
      instructions: row.config.instructions || undefined,
      model: provider.model,
      embeddings: provider.embeddings,
      llm: provider.llm,
      // The library wants at least one source to turn knowledge on. This one is embedded once and
      // never stored (writes are no-ops); searches go to the agent's own knowledge.
      // Keeps the agent on the documentation, in code (D-20).
      scope: { minScore: MIN_SCORE, offTopic: OFF_TOPIC, naturalReply: true },
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
      checkpointer: watch(new StoreCheckpointer(row.id, threads), ["getTuple", "list", "put", "putWrites"], (e) =>
        failed(row.id, e),
      ),
      threadStore:
        mode === "anon"
          ? {
              // A visitor has no thread list and no title: only the thread id they hold, for ANON_THREAD_TTL_MS.
              list: async () => [],
              has: (userId, threadId) => threads.has(row.id, userId, threadId, now() - ANON_THREAD_TTL_MS),
              touch: async (userId, threadId) => {
                await threads.touch(row.id, userId, threadId, "", now());
                // Retention without a cron, like the audit log (retention.ts).
                if (Math.floor(Math.random() * PRUNE_ODDS) === 0)
                  await threads.pruneIdle(row.id, ANON_USER_PREFIX, now() - ANON_THREAD_TTL_MS).catch(() => {});
              },
              delete: (userId, threadId) => threads.delete(row.id, userId, threadId),
            }
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
      onError:
        deps.onError || deps.debug
          ? ({ error, code, threadId }) => {
              deps.onError?.({ agentId: row.id, code, threadId, error });
              if (deps.debug) console.error("agent turn error", { agentId: row.id, code, threadId }, error);
            }
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
