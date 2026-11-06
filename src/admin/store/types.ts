// The admin's storage contract. Handlers and the data plane talk to this and nothing else, so a database is one
// implementation of it: Postgres first (store/pg), SQLite and others later. Every method is async. Nothing here
// returns a driver type.
import type { AgentConfig } from "../config.js";
import type { AgentStats, AuditPage, KnowledgeSource, SourceStatus, StatsRange, Trace, TracePage } from "../api.js";

export interface AgentRecord {
  id: string;
  ownerId: string;
  name: string;
  status: "draft" | "active";
  disabledAt: Date | null;
  configVersion: number;
  config: AgentConfig;
  llmKeySealed: string | null;
  llmKeyLast4: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What an edit may change. `configVersion` and `updatedAt` are the store's. */
export type AgentChange = Partial<
  Pick<AgentRecord, "name" | "status" | "disabledAt" | "config" | "llmKeySealed" | "llmKeyLast4">
>;

export interface AgentStorage {
  /** One owner's agents, newest first. */
  list(ownerId: string): Promise<AgentRecord[]>;
  /** By id alone: for the data plane, which has no owner. Control-plane code uses `getOwned`. */
  get(id: string): Promise<AgentRecord | null>;
  /** Another owner's agent looks the same as a missing one: null (D-9). */
  getOwned(ownerId: string, id: string): Promise<AgentRecord | null>;
  create(record: AgentRecord): Promise<void>;
  /** Applies the change and bumps `configVersion` in one statement. Null: missing or foreign. */
  update(ownerId: string, id: string, change: AgentChange): Promise<AgentRecord | null>;
  /** Deletes the agent with its knowledge, audit rows and traces. Returns the users it had threads for; null: missing or foreign. */
  remove(ownerId: string, id: string): Promise<{ userIds: string[] } | null>;
  /** Records that this user has threads under the agent. Idempotent. */
  trackUser(agentId: string, userId: string): Promise<void>;
}

export interface UsageCount {
  allowed: boolean;
  used: number;
  limit: number;
}

export interface UsageStorage {
  /** Counts one anonymous message against the agent's daily cap (D-38). Atomic: concurrent callers cannot overshoot. */
  consumeAnon(agentId: string, limit: number, now?: Date): Promise<UsageCount>;
  anonUsed(agentId: string, now?: Date): Promise<number>;
}

export type AuditResult = "ok" | "denied" | "limited" | "error";

export interface AuditInput {
  /** The turn id, shared with its trace row. */
  id?: string;
  agentId: string;
  event: string;
  result: AuditResult;
  userId?: string | null;
  reason?: string | null;
  durationMs?: number | null;
}

export interface AuditQuery {
  result?: AuditResult;
  event?: string;
  user?: string;
  range: "1h" | "24h" | "7d" | "30d";
  page: number;
}

export interface TraceQuery {
  user?: string;
  status?: Trace["status"];
  page: number;
}

export interface AuditStorage {
  /** Never throws into the request: a failed write is logged and dropped. */
  recordEvent(input: AuditInput, now?: Date): Promise<void>;
  listEvents(agentId: string, query: AuditQuery, now?: Date): Promise<AuditPage>;
  /** Counts over the range ending now and over the same length before it (see `UsageWindow`). Preview events are left out. */
  stats(agentId: string, range: StatsRange, now?: Date): Promise<AgentStats>;
  /** Never throws into the turn. */
  recordTrace(agentId: string, trace: Omit<Trace, "id">, id?: string, now?: Date): Promise<void>;
  listTraces(agentId: string, query: TraceQuery, now?: Date): Promise<TracePage>;
  getTrace(agentId: string, id: string, now?: Date): Promise<Trace | null>;
}

export interface SourceInput {
  kind: "url" | "text";
  title: string;
  url?: string | null;
  content?: string | null;
}

export interface QueuedSource {
  id: string;
  kind: "url" | "text";
  title: string;
  url: string | null;
  content: string | null;
}

export interface IndexedChunks {
  title: string;
  bytes: number;
  embedKey: string | null;
  texts: string[];
  vectors: number[][];
}

export interface Hit {
  text: string;
  score: number;
  meta: { sourceId: string; title: string; url?: string };
}

export interface KnowledgeCounts {
  sources: number;
  indexed: number;
  pending: number;
  failed: number;
  chunks: number;
}

export interface KnowledgeStorage {
  counts(agentId: string): Promise<KnowledgeCounts>;
  listSources(agentId: string): Promise<KnowledgeSource[]>;
  /** Source and chunk limits are the caller's (knowledge/ingest.ts); this stores what it is given. */
  addSource(agentId: string, input: SourceInput, now?: Date): Promise<KnowledgeSource>;
  removeSource(agentId: string, id: string): Promise<boolean>;
  /** Queues every source again, e.g. after the embedding model changed. Old vectors stay searchable until replaced. Returns how many. */
  markAllPending(agentId: string): Promise<number>;
  /** Takes the queued sources and marks them "indexing", so two workers never take the same one. */
  claimPending(agentId: string): Promise<QueuedSource[]>;
  hasPending(agentId: string): Promise<boolean>;
  /** Chunks the agent holds outside this source: for the chunk cap. */
  chunksOutside(agentId: string, sourceId: string): Promise<number>;
  /** Replaces the source's chunks and marks it indexed. False: the source was removed meanwhile; nothing is written. */
  saveIndexed(agentId: string, sourceId: string, result: IndexedChunks, now?: Date): Promise<boolean>;
  markFailed(agentId: string, sourceId: string, message: string): Promise<void>;
  /**
   * Nearest chunks by cosine similarity. With `embedKey`, only chunks made by that embedding model count (D-30):
   * vectors from another model are not comparable. Chunks from before the key existed count.
   */
  search(agentId: string, vector: number[], k: number, embedKey?: string): Promise<Hit[]>;
  /** True when some indexed source was embedded by a different model than `embedKey`, so search skips it until a re-index. */
  isStale(agentId: string, embedKey: string): Promise<boolean>;
}

export interface AdminStore {
  agents: AgentStorage;
  usage: UsageStorage;
  audit: AuditStorage;
  knowledge: KnowledgeStorage;
  threads: ThreadStorage;
  /** Creates or upgrades the tables. Safe to call on every start and from several processes at once. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export type { SourceStatus };

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
}

export interface CheckpointRow {
  threadId: string;
  ns: string;
  checkpointId: string;
  parentId: string | null;
  type: string;
  checkpoint: string;
  metadata: string;
}

export interface WriteRow {
  threadId: string;
  ns: string;
  checkpointId: string;
  taskId: string;
  idx: number;
  channel: string;
  taskPath: string;
  type: string;
  value: string;
}

export type CheckpointWithWrites = CheckpointRow & { writes: WriteRow[] };

/**
 * A user's conversations with an agent: the thread index, LangGraph checkpoints and pending writes (D-24). Threads are
 * listed and checked per user. Checkpoints are addressed by thread id alone: the library builds it as
 * `<encodeURIComponent(userId)>:<uuid>` and checks it against the signed-in user before any graph call.
 */
export interface ThreadStorage {
  /** The user's newest threads, at most 50. */
  list(agentId: string, userId: string): Promise<ThreadMeta[]>;
  has(agentId: string, userId: string, id: string): Promise<boolean>;
  touch(agentId: string, userId: string, id: string, title: string, at: number): Promise<void>;
  /** Deletes the thread with its checkpoints and writes. */
  delete(agentId: string, userId: string, id: string): Promise<void>;
  /** Every thread, checkpoint and write the user has under the agent. */
  destroyUser(agentId: string, userId: string): Promise<void>;
  getCheckpoint(
    agentId: string,
    threadId: string,
    ns: string,
    checkpointId: string | null,
  ): Promise<CheckpointWithWrites | null>;
  listCheckpoints(
    agentId: string,
    threadId: string,
    filter: { ns?: string; checkpointId?: string; before?: string },
  ): Promise<CheckpointWithWrites[]>;
  putCheckpoint(agentId: string, row: CheckpointRow): Promise<void>;
  /** Special channels (negative idx) are overwritten; ordinary writes keep the first value. */
  putWrites(agentId: string, rows: WriteRow[]): Promise<void>;
}
