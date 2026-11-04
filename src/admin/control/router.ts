// Control-plane agent API, mounted at /api/agents. Every query is scoped to the signed-in integrator: another owner's
// agent is indistinguishable from a missing one. The LLM key is write-only: no response carries it.
import { Hono } from "hono";
import type { AdminDeps } from "../deps.js";
import { auditRoutes } from "./audit.js";
import type { AgentsEnv } from "./context.js";
import { crudRoutes } from "./crud.js";
import { knowledgeRoutes } from "./knowledge.js";
import { lifecycleRoutes } from "./lifecycle.js";
import { llmRoutes } from "./llm.js";
import { previewRoutes } from "./preview.js";
import { userAuthRoutes } from "./user-auth.js";

export function agentsRouter(deps: AdminDeps) {
  return new Hono<AgentsEnv>()
    .route("/", crudRoutes(deps))
    .route("/", llmRoutes(deps))
    .route("/", userAuthRoutes(deps))
    .route("/", knowledgeRoutes(deps))
    .route("/", lifecycleRoutes(deps))
    .route("/", previewRoutes(deps))
    .route("/", auditRoutes(deps));
}
