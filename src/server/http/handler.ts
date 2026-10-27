import type { AgentConfig } from "../config.js";
import type { AgentGraph } from "../graph/index.js";
import { ownsThread, type ThreadStore } from "../threads.js";
import { checkOrigin, json, preflight } from "./cors.js";
import { readChatBody } from "./request.js";
import { handleThreadAction } from "./thread-routes.js";
import { runTurn } from "./turn.js";

export interface AuthResult {
  /** Stable identity of the signed-in user. Threads are bound to it. */
  userId: string;
  /** Headers forwarded to your API (e.g. Authorization, Cookie). Never shown to the LLM. */
  headers?: Record<string, string>;
}

export interface HandlerDeps {
  config: AgentConfig;
  graph: AgentGraph;
  threads: ThreadStore;
  secret: string;
  getAuth?: (request: Request) => AuthResult | Promise<AuthResult>;
  beforeTurn?: (ctx: { request: Request; userId: string }) => void | Promise<void>;
}

/** The agent endpoint. Each step either rejects the request or narrows what the next step may assume. */
export function createHandler(deps: HandlerDeps) {
  const { config, graph, threads, getAuth, beforeTurn } = deps;
  const active = new Map<string, number>();

  return async function handler(request: Request): Promise<Response> {
    const { ok: originOk, cors } = checkOrigin(request, config.allowedOrigins);
    if (request.method === "OPTIONS" && originOk) return preflight(cors);
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    if (!originOk) return json(403, { error: "origin not allowed" });
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json(415, { error: "content-type must be application/json" }, cors);
    }

    let auth: AuthResult;
    try {
      auth = getAuth ? await getAuth(request) : { userId: "anonymous" };
      if (!auth?.userId) throw new Error("no user");
    } catch {
      return json(401, { error: "unauthenticated" }, cors);
    }
    const { userId } = auth;

    const read = await readChatBody(request);
    if ("error" in read) return json(read.status, { error: read.error }, cors);
    const { body } = read;

    if ("action" in body) return handleThreadAction(body, { userId, threads, graph }, cors);

    if (body.threadId && !(await ownsThread(threads, userId, body.threadId))) {
      return json(404, { error: "thread not found" }, cors);
    }

    try {
      await beforeTurn?.({ request, userId });
    } catch (e) {
      return json(429, { error: (e as Error).message || "rejected" }, cors);
    }

    if ((active.get(userId) ?? 0) >= config.limits.maxConcurrentTurnsPerUser) {
      return json(429, { error: "too many concurrent turns" }, cors);
    }

    return runTurn(request, body, { userId, headers: auth.headers ?? {} }, { ...deps, active }, cors);
  };
}
