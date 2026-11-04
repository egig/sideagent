// JSON shapes of the control-plane API (/api/agents), shared by the Worker and
// the dashboard. The Worker annotates its responses with these types, so a
// change that breaks the dashboard fails typecheck on the Worker side.
import type { Algorithm } from "./limits.js";

export type AgentStatus = "active" | "inactive";

export type AuthConfig =
  | {
      mode: "jwks";
      jwksUrl: string;
      issuer: string;
      audience: string;
      acceptAnyAudience: boolean;
      userIdClaim: string;
      algorithms: Algorithm[];
    }
  | { mode: "userinfo"; url: string; userIdField: string; cacheTtlSeconds: number }
  | { mode: "anonymous" };

export type AuthMode = AuthConfig["mode"];

export type LlmConfig = { baseUrl: string; model: string; embeddingModel: string };

export interface AgentSummary {
  id: string;
  name: string;
  status: AgentStatus;
}

export interface KnowledgeCounts {
  sources: number;
  indexed: number;
  pending: number;
  failed: number;
  chunks: number;
}

/** The admin's own assistants (D-27: they send the key too). */
export interface OwnAgent {
  agentId: string;
  publishableKey: string;
}

export interface Agent extends AgentSummary {
  configVersion: number;
  createdAt: string;
  updatedAt: string;
  publishableKey: string;
  endpoint: string;
  allowedOrigins: string[];
  instructions: string;
  llm: LlmConfig | null;
  llmKey: { last4: string } | null;
  knowledge: KnowledgeCounts;
  auth: AuthConfig | null;
  tracing: TraceLevel;
}

export interface ReadinessItem {
  id: "content" | "origins" | "llm" | "auth";
  label: string;
  ok: boolean;
  detail: string;
}

/** GET /api/agents/:id and every write that returns the agent. */
export interface AgentDetail {
  agent: Agent;
  readiness: ReadinessItem[];
}

export type SourceStatus = "pending" | "indexing" | "indexed" | "failed";

export interface KnowledgeSource {
  id: string;
  kind: "url" | "text";
  title: string;
  url: string | null;
  status: SourceStatus;
  error: string | null;
  chunks: number;
  bytes: number;
  createdAt: string;
  indexedAt: string | null;
}

export type AuditResult = "ok" | "denied" | "limited" | "error";
export type AuditRange = "1h" | "24h" | "7d" | "30d";

export interface AuditEvent {
  id: string;
  at: string;
  userId: string | null;
  event: string;
  result: AuditResult;
  reason: string | null;
  durationMs: number | null;
  /** The trace of this turn, when it was recorded and is still kept (D-35). */
  traceId: string | null;
}

export interface AuditPage {
  events: AuditEvent[];
  total: number;
  pageSize: number;
  retentionDays: number;
}

/** How much of a turn is recorded for the trace view (D-35). */
export type TraceLevel = "off" | "metadata" | "full";
export const TRACE_LEVELS: readonly TraceLevel[] = ["off", "metadata", "full"];

export interface TraceSpan {
  id: string;
  /** The nearest recorded span above this one; null for a top-level span. */
  parentId: string | null;
  kind: "llm" | "tool";
  /** The model, or the search the model called. */
  name: string;
  /** Milliseconds from the start of the turn. */
  startMs: number;
  durationMs: number;
  status: "ok" | "error";
  inputTokens?: number;
  outputTokens?: number;
  /** Error class only at `metadata`; the redacted message at `full`. */
  error?: string;
  /** Present at `full` only, redacted and cut to a fixed length. */
  input?: string;
  output?: string;
}

export interface TraceSummary {
  id: string;
  at: string;
  userId: string | null;
  threadId: string | null;
  level: Exclude<TraceLevel, "off">;
  status: "ok" | "error";
  durationMs: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface Trace extends TraceSummary {
  spans: TraceSpan[];
}

export interface TracePage {
  traces: TraceSummary[];
  total: number;
  pageSize: number;
  /** Days kept, per level. */
  retentionDays: Record<Exclude<TraceLevel, "off">, number>;
}

export const MODE_LABEL: Record<AuthMode, string> = {
  jwks: "Token verification, JWKS",
  userinfo: "Token verification, userinfo URL",
  anonymous: "Anonymous",
};
