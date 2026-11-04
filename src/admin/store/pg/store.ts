// AdminStore on Postgres with pgvector, through Drizzle. Any Drizzle pg driver works: node-postgres, postgres.js,
// Neon, PGlite. This file imports no driver and no Node API, so it also runs on Workers behind Hyperdrive.
import { and, asc, count, desc, eq, gte, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AuditPage, KnowledgeSource, Trace, TracePage } from "../../api.js";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_RANGES,
  AUDIT_RETENTION_DAYS,
  DAY_MS,
  PRUNE_ODDS,
  TRACE_PAGE_SIZE,
  TRACE_RETENTION_DAYS,
} from "../retention.js";
import type {
  AdminStore,
  CheckpointWithWrites,
  AgentChange,
  AgentRecord,
  AuditInput,
  AuditQuery,
  Hit,
  IndexedChunks,
  KnowledgeCounts,
  QueuedSource,
  SourceInput,
  TraceQuery,
  UsageCount,
} from "../types.js";
import { MIGRATIONS } from "./migrations.js";
import * as t from "./schema.js";

// biome-ignore lint/suspicious/noExplicitAny: any Drizzle pg driver
export type PgDb = PgDatabase<PgQueryResultHKT, any>;

const MIGRATION_LOCK = 7_265_001;
const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
const newSourceId = () =>
  `src_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b & 31]).join("")}`;
const THREAD_LIST_MAX = 50;

/** The thread row with its checkpoints and writes. */
async function dropThread(tx: PgDb, agentId: string, id: string) {
  await tx
    .delete(t.checkpointWrite)
    .where(and(eq(t.checkpointWrite.agentId, agentId), eq(t.checkpointWrite.threadId, id)));
  await tx.delete(t.checkpoint).where(and(eq(t.checkpoint.agentId, agentId), eq(t.checkpoint.threadId, id)));
  await tx.delete(t.thread).where(and(eq(t.thread.agentId, agentId), eq(t.thread.id, id)));
}

async function withWrites(
  db: PgDb,
  agentId: string,
  rows: (typeof t.checkpoint.$inferSelect)[],
): Promise<CheckpointWithWrites[]> {
  const w = t.checkpointWrite;
  return Promise.all(
    rows.map(async ({ agentId: _a, ...r }) => ({
      ...r,
      writes: (
        await db
          .select()
          .from(w)
          .where(
            and(eq(w.agentId, agentId), eq(w.threadId, r.threadId), eq(w.ns, r.ns), eq(w.checkpointId, r.checkpointId)),
          )
      ).map(({ agentId: _w, ...x }) => x),
    })),
  );
}
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
const monthOf = (now: Date) => now.toISOString().slice(0, 7);
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

function toSource(r: typeof t.knowledgeSource.$inferSelect): KnowledgeSource {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    status: r.status,
    error: r.error,
    chunks: r.chunks,
    bytes: r.bytes,
    createdAt: r.createdAt.toISOString(),
    indexedAt: r.indexedAt ? r.indexedAt.toISOString() : null,
  };
}

const summary = (r: Omit<typeof t.auditTrace.$inferSelect, "spans" | "agentId">) => ({
  id: r.id,
  at: r.at.toISOString(),
  userId: r.userId,
  threadId: r.threadId,
  level: r.level,
  status: r.status,
  durationMs: r.durationMs,
  llmCalls: r.llmCalls,
  toolCalls: r.toolCalls,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
});

/** Rows past their level's retention are hidden even before a write prunes them. */
const alive = (now: Date) =>
  or(
    and(
      eq(t.auditTrace.level, "metadata"),
      gte(t.auditTrace.at, new Date(+now - TRACE_RETENTION_DAYS.metadata * DAY_MS)),
    ),
    and(eq(t.auditTrace.level, "full"), gte(t.auditTrace.at, new Date(+now - TRACE_RETENTION_DAYS.full * DAY_MS))),
  );

export function createPgStore(db: PgDb, options: { onClose?: () => Promise<void> } = {}): AdminStore {
  /** Counts one message with an upsert that only increments while under the cap, so concurrent callers cannot overshoot. */
  async function consume(insert: () => Promise<{ used: number }[]>, limit: number): Promise<UsageCount> {
    if (limit <= 0) return { allowed: false, used: 0, limit };
    const [row] = await insert();
    return row ? { allowed: true, used: row.used, limit } : { allowed: false, used: limit, limit };
  }

  return {
    async migrate() {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
        await tx.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS sideagent`));
        await tx.execute(
          sql.raw(
            `CREATE TABLE IF NOT EXISTS sideagent._migrations (step integer PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())`,
          ),
        );
        const done = rowsOf<{ step: number }>(await tx.execute(sql.raw(`SELECT step FROM sideagent._migrations`))).map(
          (r) => Number(r.step),
        );
        for (const [i, statements] of MIGRATIONS.entries()) {
          if (done.includes(i + 1)) continue;
          for (const statement of statements) await tx.execute(sql.raw(statement));
          await tx.execute(sql`INSERT INTO sideagent._migrations (step) VALUES (${i + 1})`);
        }
      });
    },

    async close() {
      await options.onClose?.();
    },

    agents: {
      async list(ownerId) {
        return db.select().from(t.agent).where(eq(t.agent.ownerId, ownerId)).orderBy(desc(t.agent.createdAt));
      },
      async get(id) {
        return (await db.select().from(t.agent).where(eq(t.agent.id, id)))[0] ?? null;
      },
      async getOwned(ownerId, id) {
        return (
          (
            await db
              .select()
              .from(t.agent)
              .where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)))
          )[0] ?? null
        );
      },
      async create(record: AgentRecord) {
        await db.insert(t.agent).values(record);
      },
      async update(ownerId, id, change: AgentChange) {
        const [row] = await db
          .update(t.agent)
          .set({ ...change, configVersion: sql`${t.agent.configVersion} + 1`, updatedAt: new Date() })
          .where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)))
          .returning();
        return row ?? null;
      },
      async remove(ownerId, id) {
        return db.transaction(async (tx) => {
          const found = (
            await tx
              .select({ id: t.agent.id })
              .from(t.agent)
              .where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)))
          )[0];
          if (!found) return null;
          const users = await tx
            .select({ userId: t.agentUser.userId })
            .from(t.agentUser)
            .where(eq(t.agentUser.agentId, id));
          await tx.delete(t.agent).where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)));
          return { userIds: users.map((u) => u.userId) };
        });
      },
      async trackUser(agentId, userId) {
        await db.insert(t.agentUser).values({ agentId, userId }).onConflictDoNothing();
      },
    },

    usage: {
      consumeAnon: (agentId, limit, now = new Date()) =>
        consume(
          () =>
            db
              .insert(t.agentUsage)
              .values({ agentId, day: dayOf(now), messages: 1 })
              .onConflictDoUpdate({
                target: [t.agentUsage.agentId, t.agentUsage.day],
                set: { messages: sql`${t.agentUsage.messages} + 1` },
                setWhere: lt(t.agentUsage.messages, limit),
              })
              .returning({ used: t.agentUsage.messages }),
          limit,
        ),
      async anonUsed(agentId, now = new Date()) {
        const [row] = await db
          .select({ used: t.agentUsage.messages })
          .from(t.agentUsage)
          .where(and(eq(t.agentUsage.agentId, agentId), eq(t.agentUsage.day, dayOf(now))));
        return row?.used ?? 0;
      },
    },

    audit: {
      async recordEvent(input: AuditInput, now = new Date()) {
        try {
          await db.insert(t.auditEvent).values({
            id: input.id ?? crypto.randomUUID(),
            agentId: input.agentId,
            at: now,
            userId: input.userId?.slice(0, 256) ?? null,
            event: input.event,
            result: input.result,
            reason: input.reason ?? null,
            durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
          });
          if (Math.floor(Math.random() * PRUNE_ODDS) === 0) {
            await db
              .delete(t.auditEvent)
              .where(
                and(
                  eq(t.auditEvent.agentId, input.agentId),
                  lt(t.auditEvent.at, new Date(+now - AUDIT_RETENTION_DAYS * DAY_MS)),
                ),
              );
          }
        } catch {
          console.error("audit write failed");
        }
      },

      async listEvents(agentId, q: AuditQuery, now = new Date()): Promise<AuditPage> {
        const e = t.auditEvent;
        const conds: (SQL | undefined)[] = [eq(e.agentId, agentId), gte(e.at, new Date(+now - AUDIT_RANGES[q.range]))];
        if (q.result) conds.push(eq(e.result, q.result));
        if (q.event) conds.push(eq(e.event, q.event));
        if (q.user) conds.push(eq(e.userId, q.user));
        const where = and(...conds);
        const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(e).where(where);
        const rows = await db
          .select()
          .from(e)
          .where(where)
          .orderBy(desc(e.at), desc(e.id))
          .limit(AUDIT_PAGE_SIZE)
          .offset((q.page - 1) * AUDIT_PAGE_SIZE);
        // A turn's audit row and its trace row share an id; rows from before that, and turns with tracing off, have none.
        const turns = rows.filter((r) => r.event === "chat.turn" || r.event === "preview.turn").map((r) => r.id);
        const traced = new Set(
          turns.length === 0
            ? []
            : (
                await db
                  .select({ id: t.auditTrace.id })
                  .from(t.auditTrace)
                  .where(and(eq(t.auditTrace.agentId, agentId), inArray(t.auditTrace.id, turns), alive(now)))
              ).map((r) => r.id),
        );
        return {
          total: Number(total),
          pageSize: AUDIT_PAGE_SIZE,
          retentionDays: AUDIT_RETENTION_DAYS,
          events: rows.map((r) => ({
            id: r.id,
            at: r.at.toISOString(),
            userId: r.userId,
            event: r.event,
            result: r.result,
            reason: r.reason,
            durationMs: r.durationMs,
            traceId: traced.has(r.id) ? r.id : null,
          })),
        };
      },

      async recordTrace(agentId, trace: Omit<Trace, "id">, id = crypto.randomUUID(), now = new Date()) {
        try {
          await db.insert(t.auditTrace).values({ ...trace, id, agentId, at: new Date(trace.at) });
          if (Math.floor(Math.random() * PRUNE_ODDS) === 0) {
            const a = t.auditTrace;
            await db
              .delete(a)
              .where(
                and(
                  eq(a.agentId, agentId),
                  or(
                    and(eq(a.level, "metadata"), lt(a.at, new Date(+now - TRACE_RETENTION_DAYS.metadata * DAY_MS))),
                    and(eq(a.level, "full"), lt(a.at, new Date(+now - TRACE_RETENTION_DAYS.full * DAY_MS))),
                  ),
                ),
              );
          }
        } catch {
          console.error("trace write failed");
        }
      },

      async listTraces(agentId, q: TraceQuery, now = new Date()): Promise<TracePage> {
        const a = t.auditTrace;
        const where = and(
          eq(a.agentId, agentId),
          alive(now),
          q.user ? eq(a.userId, q.user) : undefined,
          q.status ? eq(a.status, q.status) : undefined,
        );
        const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(a).where(where);
        const rows = await db
          .select({
            id: a.id,
            at: a.at,
            userId: a.userId,
            threadId: a.threadId,
            level: a.level,
            status: a.status,
            durationMs: a.durationMs,
            llmCalls: a.llmCalls,
            toolCalls: a.toolCalls,
            inputTokens: a.inputTokens,
            outputTokens: a.outputTokens,
          })
          .from(a)
          .where(where)
          .orderBy(desc(a.at), desc(a.id))
          .limit(TRACE_PAGE_SIZE)
          .offset((q.page - 1) * TRACE_PAGE_SIZE);
        return {
          total: Number(total),
          pageSize: TRACE_PAGE_SIZE,
          retentionDays: { ...TRACE_RETENTION_DAYS },
          traces: rows.map(summary),
        };
      },

      async getTrace(agentId, id, now = new Date()) {
        const a = t.auditTrace;
        const [r] = await db
          .select()
          .from(a)
          .where(and(eq(a.agentId, agentId), eq(a.id, id), alive(now)));
        return r ? { ...summary(r), spans: r.spans } : null;
      },
    },

    threads: {
      async list(agentId, userId) {
        const rows = await db
          .select({ id: t.thread.id, title: t.thread.title, updatedAt: t.thread.updatedAt })
          .from(t.thread)
          .where(and(eq(t.thread.agentId, agentId), eq(t.thread.userId, userId)))
          .orderBy(desc(t.thread.updatedAt))
          .limit(THREAD_LIST_MAX);
        return rows;
      },
      async has(agentId, userId, id) {
        const rows = await db
          .select({ id: t.thread.id })
          .from(t.thread)
          .where(and(eq(t.thread.agentId, agentId), eq(t.thread.userId, userId), eq(t.thread.id, id)))
          .limit(1);
        return rows.length > 0;
      },
      async touch(agentId, userId, id, title, at) {
        await db
          .insert(t.thread)
          .values({ agentId, userId, id, title, updatedAt: at })
          .onConflictDoUpdate({
            target: [t.thread.agentId, t.thread.id],
            set: { updatedAt: at },
            setWhere: eq(t.thread.userId, userId),
          });
      },
      async delete(agentId, userId, id) {
        await db.transaction(async (tx) => {
          const owned = await tx
            .select({ id: t.thread.id })
            .from(t.thread)
            .where(and(eq(t.thread.agentId, agentId), eq(t.thread.userId, userId), eq(t.thread.id, id)));
          if (!owned.length) return;
          await dropThread(tx, agentId, id);
        });
      },
      async destroyUser(agentId, userId) {
        await db.transaction(async (tx) => {
          const ids = await tx
            .select({ id: t.thread.id })
            .from(t.thread)
            .where(and(eq(t.thread.agentId, agentId), eq(t.thread.userId, userId)));
          for (const { id } of ids) await dropThread(tx, agentId, id);
        });
      },
      async getCheckpoint(agentId, threadId, ns, checkpointId) {
        const c = t.checkpoint;
        const rows = await db
          .select()
          .from(c)
          .where(
            and(
              eq(c.agentId, agentId),
              eq(c.threadId, threadId),
              eq(c.ns, ns),
              checkpointId ? eq(c.checkpointId, checkpointId) : undefined,
            ),
          )
          .orderBy(desc(c.checkpointId))
          .limit(1);
        return (await withWrites(db, agentId, rows))[0] ?? null;
      },
      async listCheckpoints(agentId, threadId, filter) {
        const c = t.checkpoint;
        const rows = await db
          .select()
          .from(c)
          .where(
            and(
              eq(c.agentId, agentId),
              eq(c.threadId, threadId),
              filter.ns !== undefined ? eq(c.ns, filter.ns) : undefined,
              filter.checkpointId ? eq(c.checkpointId, filter.checkpointId) : undefined,
              filter.before ? lt(c.checkpointId, filter.before) : undefined,
            ),
          )
          .orderBy(desc(c.checkpointId));
        return withWrites(db, agentId, rows);
      },
      async putCheckpoint(agentId, row) {
        await db
          .insert(t.checkpoint)
          .values({ agentId, ...row })
          .onConflictDoUpdate({
            target: [t.checkpoint.agentId, t.checkpoint.threadId, t.checkpoint.ns, t.checkpoint.checkpointId],
            set: { parentId: row.parentId, type: row.type, checkpoint: row.checkpoint, metadata: row.metadata },
          });
      },
      async putWrites(agentId, rows) {
        if (!rows.length) return;
        const w = t.checkpointWrite;
        await db.transaction(async (tx) => {
          for (const row of rows) {
            const insert = tx.insert(w).values({ agentId, ...row });
            const target = [w.agentId, w.threadId, w.ns, w.checkpointId, w.taskId, w.idx];
            if (row.idx < 0) {
              await insert.onConflictDoUpdate({
                target,
                set: { channel: row.channel, taskPath: row.taskPath, type: row.type, value: row.value },
              });
            } else {
              await insert.onConflictDoNothing({ target });
            }
          }
        });
      },
    },

    knowledge: {
      async counts(agentId): Promise<KnowledgeCounts> {
        const rows = await db
          .select({
            status: t.knowledgeSource.status,
            n: count(),
            chunks: sql<number>`coalesce(sum(${t.knowledgeSource.chunks}), 0)`,
          })
          .from(t.knowledgeSource)
          .where(eq(t.knowledgeSource.agentId, agentId))
          .groupBy(t.knowledgeSource.status);
        const by = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
        return {
          sources: rows.reduce((n, r) => n + Number(r.n), 0),
          indexed: by("indexed"),
          pending: by("pending") + by("indexing"),
          failed: by("failed"),
          chunks: rows.reduce((n, r) => n + Number(r.chunks), 0),
        };
      },

      async listSources(agentId) {
        const rows = await db
          .select()
          .from(t.knowledgeSource)
          .where(eq(t.knowledgeSource.agentId, agentId))
          .orderBy(desc(t.knowledgeSource.createdAt), asc(t.knowledgeSource.id));
        return rows.map(toSource);
      },

      async addSource(agentId, input: SourceInput, now = new Date()) {
        const [row] = await db
          .insert(t.knowledgeSource)
          .values({
            id: newSourceId(),
            agentId,
            kind: input.kind,
            title: input.title,
            url: input.url ?? null,
            content: input.content ?? null,
            status: "pending",
            bytes: input.kind === "text" ? new TextEncoder().encode(input.content ?? "").byteLength : 0,
            createdAt: now,
          })
          .returning();
        return toSource(row!);
      },

      async removeSource(agentId, id) {
        const rows = await db
          .delete(t.knowledgeSource)
          .where(and(eq(t.knowledgeSource.agentId, agentId), eq(t.knowledgeSource.id, id)))
          .returning({ id: t.knowledgeSource.id });
        return rows.length > 0;
      },

      async markAllPending(agentId) {
        const rows = await db
          .update(t.knowledgeSource)
          .set({ status: "pending", error: null })
          .where(eq(t.knowledgeSource.agentId, agentId))
          .returning({ id: t.knowledgeSource.id });
        return rows.length;
      },

      async claimPending(agentId): Promise<QueuedSource[]> {
        // FOR UPDATE SKIP LOCKED: two workers never claim the same source. "indexing" rows left by a worker that died
        // are claimed again.
        const result = await db.execute(sql`
          UPDATE sideagent."knowledgeSource" SET status = 'indexing', error = NULL
          WHERE id IN (
            SELECT id FROM sideagent."knowledgeSource"
            WHERE "agentId" = ${agentId} AND status IN ('pending', 'indexing')
            ORDER BY "createdAt" FOR UPDATE SKIP LOCKED)
          RETURNING id, kind, title, url, content, "createdAt"`);
        return rowsOf<QueuedSource & { createdAt: Date | string }>(result)
          .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
          .map(({ id, kind, title, url, content }) => ({ id, kind, title, url, content }));
      },

      async hasPending(agentId) {
        const rows = await db
          .select({ id: t.knowledgeSource.id })
          .from(t.knowledgeSource)
          .where(
            and(eq(t.knowledgeSource.agentId, agentId), inArray(t.knowledgeSource.status, ["pending", "indexing"])),
          )
          .limit(1);
        return rows.length > 0;
      },

      async chunksOutside(agentId, sourceId) {
        const [r] = await db
          .select({ n: count() })
          .from(t.knowledgeChunk)
          .where(and(eq(t.knowledgeChunk.agentId, agentId), ne(t.knowledgeChunk.sourceId, sourceId)));
        return Number(r?.n ?? 0);
      },

      async saveIndexed(agentId, sourceId, result: IndexedChunks, now = new Date()) {
        return db.transaction(async (tx) => {
          // Removed during the embedding call: drop the result. The lock keeps a concurrent remove from racing the insert.
          const [source] = await tx
            .select({ id: t.knowledgeSource.id })
            .from(t.knowledgeSource)
            .where(and(eq(t.knowledgeSource.id, sourceId), eq(t.knowledgeSource.agentId, agentId)))
            .for("update");
          if (!source) return false;
          await tx.delete(t.knowledgeChunk).where(eq(t.knowledgeChunk.sourceId, sourceId));
          if (result.texts.length) {
            await tx.insert(t.knowledgeChunk).values(
              result.texts.map((text, i) => ({
                id: `${sourceId}#${i}`,
                agentId,
                sourceId,
                ord: i,
                text,
                embedding: result.vectors[i]!,
              })),
            );
          }
          await tx
            .update(t.knowledgeSource)
            .set({
              status: "indexed",
              error: null,
              title: result.title,
              chunks: result.texts.length,
              bytes: result.bytes,
              indexedAt: now,
              embedKey: result.embedKey,
            })
            .where(eq(t.knowledgeSource.id, sourceId));
          return true;
        });
      },

      async markFailed(agentId, sourceId, message) {
        await db
          .update(t.knowledgeSource)
          .set({ status: "failed", error: message })
          .where(and(eq(t.knowledgeSource.id, sourceId), eq(t.knowledgeSource.agentId, agentId)));
      },

      async search(agentId, vector, k, embedKey): Promise<Hit[]> {
        const limit = Math.max(0, Math.min(Math.trunc(k), 50));
        if (!limit || !vector.length) return [];
        const query = `[${vector.join(",")}]`;
        const result = await db.execute(sql`
          SELECT c.text AS text, c."sourceId" AS "sourceId", s.title AS title, s.url AS url,
                 1 - (c.embedding <=> ${query}::vector) AS score
          FROM sideagent."knowledgeChunk" c
          JOIN sideagent."knowledgeSource" s ON s.id = c."sourceId"
          WHERE c."agentId" = ${agentId}
            AND vector_dims(c.embedding) = ${vector.length}
            AND (${embedKey ?? null}::text IS NULL OR s."embedKey" IS NULL OR s."embedKey" = ${embedKey ?? null})
          ORDER BY c.embedding <=> ${query}::vector
          LIMIT ${limit}`);
        return rowsOf<{ text: string; sourceId: string; title: string; url: string | null; score: number | string }>(
          result,
        ).map((r) => ({
          text: r.text,
          score: Number(r.score),
          meta: { sourceId: r.sourceId, title: r.title, ...(r.url ? { url: r.url } : {}) },
        }));
      },

      async isStale(agentId, embedKey) {
        const rows = await db
          .select({ id: t.knowledgeSource.id })
          .from(t.knowledgeSource)
          .where(
            and(
              eq(t.knowledgeSource.agentId, agentId),
              eq(t.knowledgeSource.status, "indexed"),
              ne(t.knowledgeSource.embedKey, embedKey),
            ),
          )
          .limit(1);
        return rows.length > 0;
      },
    },
  };
}
