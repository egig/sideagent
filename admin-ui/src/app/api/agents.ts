// Queries and mutations for /api/agents. Response types are in shared/api.ts,
// which the Worker also uses for its responses.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type {
  Agent,
  AgentDetail,
  AgentStats,
  StatsRange,
  AgentSummary,
  AuditPage,
  AuditRange,
  AuditResult,
  AuthConfig,
  AuthMode,
  KnowledgeSource,
  LlmCheck,
  Trace,
  TraceLevel,
} from "@shared/api";
import { api } from "./client";

const path = (id: string, rest = "") => `/agents/${encodeURIComponent(id)}${rest}`;

export const agentsQuery = queryOptions({
  queryKey: ["agents"],
  queryFn: async () => (await api<{ agents: AgentSummary[] }>("/agents")).agents,
});

export const agentQuery = (id: string) =>
  queryOptions({
    queryKey: ["agents", id],
    queryFn: () => api<AgentDetail>(path(id)),
    retry: false,
  });

export const knowledgeQuery = (id: string) =>
  queryOptions({
    queryKey: ["agents", id, "knowledge"],
    queryFn: async () => (await api<{ sources: KnowledgeSource[] }>(path(id, "/knowledge"))).sources,
    // Indexing runs in the background: poll while anything is queued.
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === "pending" || s.status === "indexing") ? 2000 : false,
  });

export interface AuditFilters {
  result: AuditResult | "";
  event: string;
  user: string;
  range: AuditRange;
  page: number;
}

export const auditQuery = (id: string, f: AuditFilters) =>
  queryOptions({
    queryKey: ["agents", id, "audit", f],
    queryFn: () => {
      const q = new URLSearchParams({ range: f.range, page: String(f.page) });
      if (f.result) q.set("result", f.result);
      if (f.event) q.set("event", f.event);
      if (f.user) q.set("user", f.user);
      return api<AuditPage>(path(id, `/audit?${q}`));
    },
    placeholderData: keepPreviousData,
  });

export const statsQuery = (id: string, range: StatsRange) =>
  queryOptions({
    queryKey: ["agents", id, "stats", range],
    queryFn: () => api<AgentStats>(path(id, `/stats?range=${range}`)),
    placeholderData: keepPreviousData,
  });

export const traceQuery = (id: string, traceId: string) =>
  queryOptions({
    queryKey: ["agents", id, "traces", "one", traceId],
    queryFn: () => api<Trace>(path(id, `/traces/${encodeURIComponent(traceId)}`)),
    // A trace never changes once written.
    staleTime: Infinity,
  });

const send = <T = AgentDetail>(method: string, url: string, json?: unknown) =>
  api<T>(url, { method, ...(json !== undefined && { body: JSON.stringify(json) }) });

export const createAgent = (input: { name: string }) => send("POST", "/agents", input);
export const updateGeneral = (
  id: string,
  input: Partial<Pick<Agent, "name" | "allowedOrigins" | "instructions" | "offTopic">>,
) => send("PATCH", path(id), input);
export const updateTracing = (id: string, level: TraceLevel) => send("PUT", path(id, "/tracing"), { level });
export const updateLlm = (
  id: string,
  input:
    | { provider: "builtin" }
    | { provider: "custom"; baseUrl: string; model: string; embeddingModel: string; apiKey?: string },
) => send("PUT", path(id, "/llm"), input);
export const checkLlm = (id: string) => send<LlmCheck>("POST", path(id, "/llm/check"));
export const addKnowledge = (
  id: string,
  input: { kind: "url"; url: string; title?: string } | { kind: "text"; title: string; content: string },
) => send<{ source: KnowledgeSource }>("POST", path(id, "/knowledge"), input);
export const removeKnowledge = (id: string, sourceId: string) =>
  send<null>("DELETE", path(id, `/knowledge/${encodeURIComponent(sourceId)}`));
export const reindexKnowledge = (id: string) => send<{ queued: number }>("POST", path(id, "/knowledge/reindex"));
export const updateAuth = (id: string, input: Partial<AuthConfig> & { mode: AuthMode }) =>
  send("PUT", path(id, "/auth"), input);
export const setActive = (id: string, active: boolean) => send("POST", path(id, active ? "/activate" : "/deactivate"));
export const deleteAgent = (id: string) => send<null>("DELETE", path(id));
