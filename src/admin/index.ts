// sideagent/admin: the multi-tenant agent server with its dashboard API. Plug in a database (a store), a sign-in
// (`session`) and a network guard, mount `createAdmin(deps).fetch` in any Hono, Workers or Node server.
import { Hono } from "hono";
import { createAdminApi } from "./app.js";
import { dataPlaneRouter } from "./data/router.js";
import type { AdminDeps } from "./deps.js";

export type { AdminDeps, AdminUser } from "./deps.js";
export type {
  AdminStore,
  AgentRecord,
  AgentChange,
  AgentStorage,
  AuditInput,
  AuditQuery,
  AuditStorage,
  CheckpointRow,
  CheckpointWithWrites,
  Hit,
  IndexedChunks,
  KnowledgeCounts,
  KnowledgeStorage,
  QueuedSource,
  SourceInput,
  ThreadMeta,
  ThreadStorage,
  TraceQuery,
  UsageCount,
  UsageStorage,
  WriteRow,
} from "./store/types.js";
export type {
  Agent,
  AgentDetail,
  AuditEvent,
  AuditPage,
  KnowledgeSource,
  ReadinessItem,
  Trace,
  TracePage,
  TraceSpan,
  TraceSummary,
} from "./api.js";
export { dohResolve } from "./url-guard.js";
export { indexPending } from "./knowledge/sources.js";
export { KnowledgeError, type Embed } from "./knowledge/ingest.js";
export type { BuiltinProvider, BuiltinUsage } from "./builtin.js";
export { turnstileChallenge, type Challenge } from "./data/challenge.js";

/**
 * The whole admin: the dashboard API at `/api` and the data plane at `/v1/agents/:id`, which speaks the sideagent wire
 * protocol. Serve the dashboard's static files yourself, or with `adminUiDir`.
 */
export function createAdmin(deps: AdminDeps) {
  const data = dataPlaneRouter(deps);
  const full: AdminDeps = {
    ...deps,
    preview: data.preview,
    destroyThreads: deps.destroyThreads ?? ((agentId, userId) => deps.store.threads.destroyUser(agentId, userId)),
  };
  const app = new Hono();
  // Public routes, registered before the session-guarded API so its guard never runs for them.
  if (deps.auth) {
    const auth = deps.auth;
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
    app.get("/api/auth-providers", (c) => c.json(auth.providers));
  }
  app.route("/v1/agents", data);
  app.route("/", createAdminApi(full));
  return app;
}
