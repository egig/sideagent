import { HumanMessage } from "@langchain/core/messages";
import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { OpenAIEmbeddings } from "@langchain/openai";
import { z } from "zod";
import type { AgentEvent } from "../protocol.js";
import { verifyApproval } from "./approval.js";
import { parseConfig, type AgentConfigInput } from "./config.js";
import { buildGraph, type PendingApproval } from "./graph.js";
import { KnowledgeBase, SEARCH_TOOL, type VectorStore } from "./knowledge.js";
import { loadOperations } from "./openapi.js";
import { toHistory } from "./history.js";
import type { AuditEvent } from "./policy.js";
import { MemoryThreadStore, titleFrom, type ThreadStore } from "./threads.js";

export interface AuthResult {
  /** Stable identity of the signed-in user. Threads are bound to it. */
  userId: string;
  /** Headers forwarded to your API (e.g. Authorization, Cookie). Never shown to the LLM. */
  headers?: Record<string, string>;
}

export interface CreateAgentOptions extends AgentConfigInput {
  getAuth?: (request: Request) => AuthResult | Promise<AuthResult>;
  /** Throw to reject a turn (rate limiting, quota). */
  beforeTurn?: (ctx: { request: Request; userId: string }) => void | Promise<void>;
  onAudit?: (event: AuditEvent) => void | Promise<void>;
  checkpointer?: BaseCheckpointSaver;
  /** Index of each user's conversations (history list). Defaults to in-memory. */
  threadStore?: ThreadStore;
  /** Where knowledge embeddings live. Defaults to in-memory (re-embedded on every start). */
  vectorStore?: VectorStore;
}

const chatBody = z.union([
  z.object({ action: z.literal("threads.list") }),
  z.object({ action: z.enum(["threads.get", "threads.delete"]), threadId: z.string() }),
  z.object({ threadId: z.string().optional(), message: z.string().min(1).max(8000), context: z.unknown().optional() }),
  z.object({
    threadId: z.string(),
    approval: z.object({ token: z.string(), decision: z.enum(["approve", "reject"]) }),
  }),
]);

const enc = encodeURIComponent;
const MAX_BODY = 256 * 1024;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}

export interface DoctorReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  tools: { operationId: string; method: string; path: string; approval: "required" | "auto" }[];
  knowledge?: { id: string; title: string; url?: string; chunks: number; error?: string }[];
}

export async function createAgent(options: CreateAgentOptions) {
  const { getAuth, beforeTurn, onAudit, checkpointer, threadStore: givenStore, vectorStore, ...data } = options;
  const config = parseConfig(data, !!getAuth);
  const ops = await loadOperations(config.spec, config.allow, config.limits.maxTools);

  const secret: string = config.approvalSecret ?? crypto.randomUUID() + crypto.randomUUID();
  if (!config.approvalSecret) {
    console.warn("[sideagent] approvalSecret not set: using a random per-instance secret. Set it on serverless/multi-instance deployments.");
  }
  const threads: ThreadStore = givenStore ?? new MemoryThreadStore();
  if (checkpointer && !givenStore) {
    console.warn("[sideagent] persistent checkpointer without a threadStore: the history list is in-memory and will not survive restarts.");
  }
  if (!checkpointer) {
    console.warn("[sideagent] using the in-memory checkpointer: conversations are lost on restart. Pass a persistent checkpointer for production.");
  }

  let knowledge: KnowledgeBase | undefined;
  if (config.knowledge) {
    if (ops.some((o) => o.operationId === SEARCH_TOOL)) {
      throw new Error(`An allowlisted operation is named "${SEARCH_TOOL}", which is reserved for knowledge search`);
    }
    const k = config.knowledge;
    const embedder = new OpenAIEmbeddings({
      model: k.embeddings.model,
      apiKey: k.embeddings.apiKey ?? config.llm.apiKey,
      configuration: { baseURL: k.embeddings.baseUrl ?? config.llm.baseUrl },
    });
    knowledge = new KnowledgeBase(k, {
      embedDocuments: (t) => embedder.embedDocuments(t),
      embedQuery: (t) => embedder.embedQuery(t),
      store: vectorStore,
      allowPrivateNetworks: config.allowPrivateNetworks,
    });
    // Don't let a slow or dead embeddings host block startup forever; loading continues in the background.
    const loading = knowledge.load();
    const timedOut = await Promise.race([loading.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 60_000))]);
    if (timedOut) console.warn("[sideagent] knowledge is still loading after 60s; search results may be incomplete until it finishes.");
  }

  const graph = buildGraph({ config, ops, secret, checkpointer, onAudit, knowledge });
  const active = new Map<string, number>();

  async function handler(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const originOk = !!origin && config.allowedOrigins.some((o) => new URL(o).origin === origin);
    // CORS headers are only ever sent to origins on the allowlist.
    const cors: Record<string, string> = originOk
      ? { "access-control-allow-origin": origin!, "access-control-allow-credentials": "true", vary: "origin" }
      : {};
    if (request.method === "OPTIONS" && originOk) {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "600" },
      });
    }
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

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(413, { error: "body too large" }, cors);
    let parsed;
    try {
      parsed = chatBody.safeParse(JSON.parse(raw));
    } catch {
      return json(400, { error: "invalid json" }, cors);
    }
    if (!parsed.success) return json(400, { error: "invalid request" }, cors);
    const body = parsed.data;

    const owner = `${enc(userId)}:`;

    if ("action" in body) {
      if (body.action === "threads.list") return json(200, { threads: (await threads.list(userId)).slice(0, 50) }, cors);
      // get/delete: the thread must be in this user's own index, not just carry their prefix
      if (!body.threadId.startsWith(owner) || !(await threads.has(userId, body.threadId))) {
        return json(404, { error: "thread not found" }, cors);
      }
      if (body.action === "threads.delete") {
        await threads.delete(userId, body.threadId);
        await (graph.checkpointer as { deleteThread?: (id: string) => Promise<void> } | undefined)?.deleteThread?.(body.threadId);
        return json(200, { ok: true }, cors);
      }
      const snap = await graph.getState({ configurable: { thread_id: body.threadId } });
      const waiting = snap.tasks.flatMap((t) => t.interrupts)[0]?.value as PendingApproval | undefined;
      return json(200, { messages: toHistory(snap.values.messages ?? []), ...(waiting ? { pending: { type: "approval.request", ...waiting } } : {}) }, cors);
    }

    if (body.threadId && (!body.threadId.startsWith(owner) || !(await threads.has(userId, body.threadId)))) {
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

    const threadId = body.threadId ?? `${owner}${crypto.randomUUID()}`;
    const runCfg = { configurable: { thread_id: threadId, run: { userId, headers: auth.headers ?? {}, context: "message" in body ? body.context : undefined } } };

    const snapshot = body.threadId ? await graph.getState(runCfg) : undefined;
    const pending = snapshot?.tasks.flatMap((t) => t.interrupts)[0]?.value as PendingApproval | undefined;

    let input: Command | { messages: HumanMessage[] };
    if ("approval" in body) {
      if (!pending) return json(409, { error: "no pending approval" }, cors);
      const ok =
        body.approval.token === pending.token &&
        (await verifyApproval(secret, body.approval.token, {
          threadId,
          callId: pending.callId,
          operationId: pending.operationId,
          args: pending.args,
        }));
      if (!ok) return json(403, { error: "invalid or expired approval" }, cors);
      input = new Command({ resume: { decision: body.approval.decision } });
    } else {
      if (pending) return json(409, { error: "resolve the pending approval first" }, cors);
      input = { messages: [new HumanMessage(body.message)] };
    }

    await threads.touch(userId, threadId, titleFrom("message" in body ? body.message : ""));
    active.set(userId, (active.get(userId) ?? 0) + 1);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("turn timed out")), config.limits.turnTimeoutMs);
    request.signal.addEventListener("abort", () => timeout.abort(), { once: true });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: AgentEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            /* client went away */
          }
        };
        send({ type: "turn.start", threadId });
        try {
          const events = await graph.stream(input as any, {
            ...runCfg,
            signal: timeout.signal,
            recursionLimit: config.limits.maxSteps * 2 + 2,
            streamMode: ["messages", "custom"],
          });
          for await (const [mode, chunk] of events as AsyncIterable<[string, any]>) {
            if (mode === "custom") send(chunk as AgentEvent);
            else if (mode === "messages") {
              const [msg, meta] = chunk;
              if (meta?.langgraph_node === "agent" && typeof msg.content === "string" && msg.content) {
                send({ type: "text.delta", text: msg.content });
              }
            }
          }
          const after = await graph.getState(runCfg);
          const waiting = after.tasks.flatMap((t) => t.interrupts)[0]?.value as PendingApproval | undefined;
          if (waiting) send({ type: "approval.request", ...waiting });
        } catch (e) {
          const msg = (e as Error).message ?? "error";
          const code = /recursion/i.test(msg) ? "step_limit" : /timed out/i.test(msg) ? "timeout" : "error";
          send({ type: "error", code, message: code === "error" ? "The agent failed. Try again." : msg });
        } finally {
          clearTimeout(timer);
          active.set(userId, Math.max(0, (active.get(userId) ?? 1) - 1));
          send({ type: "turn.end" });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  }

  async function doctor(): Promise<DoctorReport> {
    const checks: DoctorReport["checks"] = [];
    checks.push({ name: "spec", ok: true, detail: `${ops.length} operation(s) exposed` });
    if (secret === config.approvalSecret) checks.push({ name: "approvalSecret", ok: true, detail: "set" });
    else checks.push({ name: "approvalSecret", ok: false, detail: "not set; random per instance" });
    try {
      const res = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
        body: JSON.stringify({
          model: config.llm.model,
          messages: [{ role: "user", content: "Call the ping tool." }],
          tools: [{ type: "function", function: { name: "ping", description: "ping", parameters: { type: "object", properties: {} } } }],
          tool_choice: { type: "function", function: { name: "ping" } },
        }),
      });
      if (!res.ok) checks.push({ name: "llm", ok: false, detail: `HTTP ${res.status}` });
      else {
        const j: any = await res.json();
        const called = j?.choices?.[0]?.message?.tool_calls?.length > 0;
        checks.push({ name: "llm tool calling", ok: called, detail: called ? "supported" : "model did not return a tool call" });
      }
    } catch (e) {
      checks.push({ name: "llm", ok: false, detail: (e as Error).message });
    }
    if (knowledge) {
      const st = knowledge.status();
      const bad = st.filter((x) => x.error);
      checks.push({
        name: "knowledge",
        ok: bad.length === 0 && st.some((x) => x.chunks > 0),
        detail: `${st.reduce((n, x) => n + x.chunks, 0)} chunk(s) from ${st.length} source(s)${bad.length ? `; failed: ${bad.map((b) => b.id).join(", ")}` : ""}`,
      });
    }
    return {
      ok: checks.every((c) => c.ok),
      checks,
      knowledge: knowledge?.status().map(({ id, title, url, chunks, error }) => ({ id, title, url, chunks, error })),
      tools: ops.map((o) => ({
        operationId: o.operationId,
        method: o.method.toUpperCase(),
        path: o.path,
        approval: o.needsApproval ? "required" : "auto",
      })),
    };
  }

  return { handler, doctor, tools: ops.map((o) => o.operationId), knowledge };
}

export type Agent = Awaited<ReturnType<typeof createAgent>>;
