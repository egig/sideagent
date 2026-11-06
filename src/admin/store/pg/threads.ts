import { and, desc, eq, gte, like, lt } from "drizzle-orm";
import type { AdminStore, CheckpointWithWrites } from "../types.js";
import type { PgDb } from "./db.js";
import * as t from "./schema.js";

const THREAD_LIST_MAX = 50;
const PRUNE_BATCH = 200;

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

export const threadsStore = (db: PgDb): AdminStore["threads"] => ({
  async list(agentId, userId) {
    const rows = await db
      .select({ id: t.thread.id, title: t.thread.title, updatedAt: t.thread.updatedAt })
      .from(t.thread)
      .where(and(eq(t.thread.agentId, agentId), eq(t.thread.userId, userId)))
      .orderBy(desc(t.thread.updatedAt))
      .limit(THREAD_LIST_MAX);
    return rows;
  },
  async has(agentId, userId, id, since) {
    const rows = await db
      .select({ id: t.thread.id })
      .from(t.thread)
      .where(
        and(
          eq(t.thread.agentId, agentId),
          eq(t.thread.userId, userId),
          eq(t.thread.id, id),
          since === undefined ? undefined : gte(t.thread.updatedAt, since),
        ),
      )
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
  async pruneIdle(agentId, userPrefix, before) {
    // The prefix is literal text, not a pattern.
    const prefix = `${userPrefix.replace(/[\\%_]/g, "\\$&")}%`;
    await db.transaction(async (tx) => {
      const idle = await tx
        .select({ id: t.thread.id })
        .from(t.thread)
        .where(and(eq(t.thread.agentId, agentId), like(t.thread.userId, prefix), lt(t.thread.updatedAt, before)))
        .limit(PRUNE_BATCH);
      for (const { id } of idle) await dropThread(tx, agentId, id);
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
});
