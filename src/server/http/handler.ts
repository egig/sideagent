import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { AgentConfig } from "../config.js";
import type { AgentGraph } from "../graph/index.js";
import { ownsThread, type ThreadStore } from "../threads.js";
import { checkOrigin, preflight } from "../security/origin.js";
import { json } from "./json.js";
import { readChatBody } from "./request.js";
import { handleThreadAction } from "./thread-routes.js";
import { createSlots } from "./slots.js";
import { runTurn, type TurnErrorContext } from "./turn.js";

export interface AuthResult {
  /** Stable identity of the signed-in user. Threads are bound to it. */
  userId: string;
}

export interface HandlerDeps {
  config: AgentConfig;
  graph: AgentGraph;
  threads: ThreadStore;
  getAuth?: (request: Request) => AuthResult | Promise<AuthResult>;
  beforeTurn?: (ctx: { request: Request; userId: string }) => void | Promise<void>;
  exposeKnowledge?: (ctx: { request: Request; userId: string }) => boolean | Promise<boolean>;
  callbacks?: (ctx: { request: Request; userId: string }) => Callbacks | undefined | Promise<Callbacks | undefined>;
  onError?: (ctx: TurnErrorContext) => void | Promise<void>;
}

/** The agent endpoint. Each step either rejects the request or narrows what the next step may assume. */
export function createHandler(deps: HandlerDeps) {
  const { config, graph, threads, getAuth, beforeTurn, exposeKnowledge, callbacks } = deps;
  const slots = createSlots(config.limits.maxConcurrentTurnsPerUser);

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

    const slot = slots.reserve(userId, body.threadId);
    if ("denied" in slot) {
      return slot.denied === "thread"
        ? json(409, { error: "a turn is already running for this thread" }, cors)
        : json(429, { error: "too many concurrent turns" }, cors);
    }

    // From here the slot is held until the stream ends (turn.ts), or released at once if the turn never starts.
    try {
      // A per-request switch that only the host can flip. A throwing callback means no; it is never read from
      // the request body.
      const asked = { request, userId };
      let expose = false;
      try {
        expose = (await exposeKnowledge?.(asked)) === true;
      } catch {
        /* stays false */
      }
      let traced: Callbacks | undefined;
      try {
        traced = await callbacks?.(asked);
      } catch {
        /* no tracing */
      }

      return await runTurn(
        request,
        body,
        { userId, exposeKnowledge: expose, callbacks: traced },
        { ...deps, release: slot.release },
        cors,
      );
    } catch (e) {
      slot.release();
      throw e;
    }
  };
}
