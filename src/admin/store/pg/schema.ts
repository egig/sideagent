// Postgres schema for the admin (Drizzle). Everything lives in the `sideagent` Postgres schema, so it never
// collides with the host app's tables. `ownerId` and `userId` name people in the host's (or the bundled)
// auth tables, so they carry no foreign key: the admin works with any sign-in. The SQL that creates these
// tables is in migrations.ts; a test keeps the two in step.
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AgentConfig } from "../../config.js";
import type { TraceSpan } from "../../api.js";

export const admin = pgSchema("sideagent");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const timestamps = {
  createdAt: ts("createdAt").notNull(),
  updatedAt: ts("updatedAt").notNull(),
};

/** pgvector `vector` without a fixed size: agents embed with different models. Search filters on `vector_dims`. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (v) => `[${v.join(",")}]`,
  fromDriver: (v) => (v.startsWith("[") ? (JSON.parse(v) as number[]) : []),
});

// One row per agent, owned by an integrator (D-8, D-9). Every config edit increments configVersion. Secrets are
// sealed (crypto.ts) and never leave the server in plaintext.
export const agent = admin.table(
  "agent",
  {
    id: text("id").primaryKey(),
    ownerId: text("ownerId").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "active"] }).notNull(),
    disabledAt: ts("disabledAt"),
    configVersion: integer("configVersion").notNull(),
    config: jsonb("config").$type<AgentConfig>().notNull(),
    llmKeySealed: text("llmKeySealed"),
    llmKeyLast4: text("llmKeyLast4"),
    ...timestamps,
  },
  (t) => [index("agent_ownerId_idx").on(t.ownerId)],
);

// Messages from anonymous visitors per agent per day (UTC) (D-38).
export const agentUsage = admin.table(
  "agentUsage",
  {
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    messages: integer("messages").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.day] })],
);

// Tenant audit log: what happened on an agent's data plane. Never holds message text, tokens or keys.
export const auditEvent = admin.table(
  "auditEvent",
  {
    id: text("id").primaryKey(),
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    userId: text("userId"),
    event: text("event").notNull(),
    result: text("result", { enum: ["ok", "denied", "limited", "error"] }).notNull(),
    reason: text("reason"),
    durationMs: integer("durationMs"),
  },
  (t) => [index("auditEvent_agent_at_idx").on(t.agentId, t.at)],
);

// Trace of one turn (D-35): the spans in one JSON column, so a turn costs one write.
export const auditTrace = admin.table(
  "auditTrace",
  {
    id: text("id").primaryKey(),
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    userId: text("userId"),
    threadId: text("threadId"),
    level: text("level", { enum: ["metadata", "full"] }).notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    durationMs: integer("durationMs").notNull(),
    llmCalls: integer("llmCalls").notNull(),
    toolCalls: integer("toolCalls").notNull(),
    inputTokens: integer("inputTokens"),
    outputTokens: integer("outputTokens"),
    spans: jsonb("spans").$type<TraceSpan[]>().notNull(),
  },
  (t) => [index("auditTrace_agent_at_idx").on(t.agentId, t.at)],
);

// Users who have threads for an agent, so deleting the agent can delete their threads.
export const agentUser = admin.table(
  "agentUser",
  {
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    userId: text("userId").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.userId] })],
);

export const knowledgeSource = admin.table(
  "knowledgeSource",
  {
    id: text("id").primaryKey(),
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["url", "text"] }).notNull(),
    title: text("title").notNull(),
    url: text("url"),
    content: text("content"),
    status: text("status", { enum: ["pending", "indexing", "indexed", "failed"] }).notNull(),
    error: text("error"),
    chunks: integer("chunks").notNull().default(0),
    bytes: integer("bytes").notNull().default(0),
    /** Names the embedding model behind the vectors (D-30). Null: indexed before the key existed. */
    embedKey: text("embedKey"),
    createdAt: ts("createdAt").notNull(),
    indexedAt: ts("indexedAt"),
  },
  (t) => [index("knowledgeSource_agent_idx").on(t.agentId, t.createdAt)],
);

export const knowledgeChunk = admin.table(
  "knowledgeChunk",
  {
    id: text("id").primaryKey(),
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    sourceId: text("sourceId")
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding").notNull(),
  },
  (t) => [index("knowledgeChunk_agent_idx").on(t.agentId), index("knowledgeChunk_source_idx").on(t.sourceId)],
);

export const thread = admin.table(
  "thread",
  {
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    userId: text("userId").notNull(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.id] }), index("thread_user_idx").on(t.agentId, t.userId, t.updatedAt)],
);

export const checkpoint = admin.table(
  "checkpoint",
  {
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    threadId: text("threadId").notNull(),
    ns: text("ns").notNull(),
    checkpointId: text("checkpointId").notNull(),
    parentId: text("parentId"),
    type: text("type").notNull(),
    checkpoint: text("checkpoint").notNull(),
    metadata: text("metadata").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.threadId, t.ns, t.checkpointId] })],
);

export const checkpointWrite = admin.table(
  "checkpointWrite",
  {
    agentId: text("agentId")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    threadId: text("threadId").notNull(),
    ns: text("ns").notNull(),
    checkpointId: text("checkpointId").notNull(),
    taskId: text("taskId").notNull(),
    idx: integer("idx").notNull(),
    channel: text("channel").notNull(),
    taskPath: text("taskPath").notNull(),
    type: text("type").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.threadId, t.ns, t.checkpointId, t.taskId, t.idx] })],
);
// Sign-in tables of the bundled auth (better-auth 1.7.14: core plus database rate limiting). Keep the column names
// better-auth expects. Upgrading better-auth means checking this against its core schema.
export const user = admin.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  ...timestamps,
});

export const session = admin.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = admin.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: ts("accessTokenExpiresAt"),
    refreshTokenExpiresAt: ts("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = admin.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expiresAt").notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const rateLimit = admin.table("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("lastRequest", { mode: "number" }).notNull(),
});

export const authTables = { user, session, account, verification, rateLimit };

export const tables = {
  agent,
  agentUsage,
  auditEvent,
  auditTrace,
  agentUser,
  knowledgeSource,
  knowledgeChunk,
  thread,
  checkpoint,
  checkpointWrite,
  ...authTables,
};
